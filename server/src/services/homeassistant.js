// Zwei-Wege-Abgleich zwischen Einkaufslisten und Home-Assistant-To-do-Listen (todo.*).
// Funktioniert auch mit der Cookidoo-Integration von Home Assistant (todo.cookidoo_*).
import { knex } from '../db.js';
import { getSettings } from '../settings.js';
import { decrypt } from '../util.js';
import { safeFetch } from './fetch.js';
import { formatAmount } from './ingredients.js';
import { notifyScope } from '../events.js';

async function haConfig() {
  const s = await getSettings();
  const token = decrypt(s.ha.token_enc);
  if (!s.ha.url || !token) return null;
  return { url: s.ha.url.replace(/\/$/, ''), token, poll: Math.max(10, Number(s.ha.poll_seconds) || 30) };
}

async function ha(cfg, path, body) {
  const res = await safeFetch(`${cfg.url}${path}`, {
    allowPrivate: true,
    timeout: 15000,
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
  });
  const t = res.text();
  return t ? JSON.parse(t) : null;
}

export async function haTest(url, token) {
  const cfg = { url: url.replace(/\/$/, ''), token };
  const info = await ha(cfg, '/api/');
  return { ok: true, message: info?.message || 'OK' };
}

export async function haTodoEntities() {
  const cfg = await haConfig();
  if (!cfg) return [];
  const states = await ha(cfg, '/api/states');
  return states
    .filter((s) => s.entity_id.startsWith('todo.'))
    .map((s) => ({ entity_id: s.entity_id, name: s.attributes?.friendly_name || s.entity_id, count: Number(s.state) || 0 }));
}

async function getItems(cfg, entityId) {
  const res = await ha(cfg, '/api/services/todo/get_items?return_response', { entity_id: entityId });
  return res?.service_response?.[entityId]?.items || [];
}

export function itemSummary(item) {
  const amt = item.amount != null ? formatAmount(item.amount) : '';
  const qty = [amt, item.unit].filter(Boolean).join(' ');
  return qty ? `${item.name} (${qty})` : item.name;
}

function parseSummary(summary) {
  const m = String(summary).match(/^(.*?)\s*\((\d+(?:[.,]\d+)?)\s*([^)]*)\)\s*$/);
  if (m) return { name: m[1].trim(), amount: Number(m[2].replace(',', '.')), unit: m[3].trim() };
  return { name: String(summary).trim(), amount: null, unit: '' };
}

const running = new Set();

/** Führt den Abgleich für eine Verknüpfung durch. */
export async function syncLink(linkId) {
  if (running.has(linkId)) return;
  running.add(linkId);
  try {
    const cfg = await haConfig();
    const link = await knex('ha_links').where({ id: linkId }).first();
    if (!cfg || !link) return;
    const list = await knex('shopping_lists').where({ id: link.list_id }).first();
    if (!list) return;
    let changed = false;
    try {
      let remote = await getItems(cfg, link.entity_id);
      const byUid = new Map(remote.map((r) => [r.uid, r]));
      const maps = await knex('ha_item_map').where({ link_id: link.id });
      const mapByItem = new Map(maps.map((m) => [m.item_id, m]));
      const mappedUids = new Set(maps.map((m) => m.ha_uid));
      const items = await knex('shopping_items').where({ list_id: list.id });
      const itemById = new Map(items.map((i) => [i.id, i]));

      // 1) Verknüpfte Einträge abgleichen
      for (const m of maps) {
        const item = itemById.get(m.item_id);
        const r = byUid.get(m.ha_uid);
        if (!item && r) {
          // Lokal gelöscht -> in HA entfernen
          await ha(cfg, '/api/services/todo/remove_item', { entity_id: link.entity_id, item: r.uid }).catch(() => {});
          await knex('ha_item_map').where({ link_id: link.id, item_id: m.item_id }).del();
          continue;
        }
        if (item && !r) {
          // In HA entfernt -> hier löschen
          await knex('shopping_items').where({ id: item.id }).del();
          await knex('ha_item_map').where({ link_id: link.id, item_id: m.item_id }).del();
          changed = true;
          continue;
        }
        if (!item || !r) {
          await knex('ha_item_map').where({ link_id: link.id, item_id: m.item_id }).del();
          continue;
        }
        const localStatus = item.checked ? 'completed' : 'needs_action';
        const summary = itemSummary(item);
        const remoteChanged = r.status !== m.ha_status || r.summary !== m.ha_summary;
        const localChanged = localStatus !== m.ha_status || summary !== m.ha_summary;
        if (remoteChanged && !localChanged) {
          const parsed = parseSummary(r.summary);
          await knex('shopping_items').where({ id: item.id }).update({
            checked: r.status === 'completed',
            ...(r.summary !== m.ha_summary ? parsed : {}),
            updated_at: knex.fn.now(),
          });
          changed = true;
          await knex('ha_item_map').where({ link_id: link.id, item_id: item.id }).update({ ha_status: r.status, ha_summary: r.summary });
        } else if (localChanged) {
          await ha(cfg, '/api/services/todo/update_item', { entity_id: link.entity_id, item: r.uid, rename: summary, status: localStatus });
          await knex('ha_item_map').where({ link_id: link.id, item_id: item.id }).update({ ha_status: localStatus, ha_summary: summary });
        }
      }

      // 2) Neue lokale Einträge nach HA übertragen
      const fresh = await knex('ha_item_map').where({ link_id: link.id }).select('item_id');
      const mappedItems = new Set(fresh.map((f) => f.item_id));
      const toPush = (await knex('shopping_items').where({ list_id: list.id })).filter((i) => !mappedItems.has(i.id) && !i.checked);
      const pushed = [];
      for (const item of toPush) {
        const summary = itemSummary(item);
        await ha(cfg, '/api/services/todo/add_item', { entity_id: link.entity_id, item: summary });
        pushed.push({ item, summary });
      }
      if (pushed.length) {
        remote = await getItems(cfg, link.entity_id);
        const taken = new Set(mappedUids);
        for (const { item, summary } of pushed) {
          const r = remote.find((x) => x.summary === summary && !taken.has(x.uid));
          if (r) {
            taken.add(r.uid);
            mappedUids.add(r.uid);
            await knex('ha_item_map').insert({ link_id: link.id, item_id: item.id, ha_uid: r.uid, ha_summary: r.summary, ha_status: r.status });
          }
        }
      }

      // 3) Neue Einträge aus HA übernehmen (nur offene)
      for (const r of remote) {
        if (mappedUids.has(r.uid) || r.status === 'completed') continue;
        const parsed = parseSummary(r.summary);
        const [id] = await knex('shopping_items').insert({ list_id: list.id, ...parsed, category: null, checked: false, sources: JSON.stringify([{ type: 'ha', entity: link.entity_id }]) });
        await knex('ha_item_map').insert({ link_id: link.id, item_id: id, ha_uid: r.uid, ha_summary: r.summary, ha_status: r.status });
        changed = true;
      }
      await knex('ha_links').where({ id: link.id }).update({ last_sync: knex.fn.now(), last_error: null });
    } catch (err) {
      await knex('ha_links').where({ id: link.id }).update({ last_error: String(err.message).slice(0, 500) });
    }
    if (changed) {
      await knex('shopping_lists').where({ id: list.id }).update({ updated_at: knex.fn.now() });
      notifyScope({ ownerId: list.owner_id, groupId: list.group_id }, { type: 'shopping', listId: list.id });
    }
  } finally {
    running.delete(linkId);
  }
}

const pending = new Map();
/** Nach lokalen Änderungen zeitnah (entprellt) abgleichen. */
export async function scheduleListSync(listId) {
  const links = await knex('ha_links').where({ list_id: listId }).select('id');
  for (const l of links) {
    clearTimeout(pending.get(l.id));
    pending.set(l.id, setTimeout(() => { pending.delete(l.id); syncLink(l.id).catch(() => {}); }, 1500));
  }
}

/** Vor dem Löschen eines lokalen Eintrags: in HA entfernen. */
export async function removeRemoteForItems(itemIds) {
  if (!itemIds.length) return;
  const cfg = await haConfig();
  const maps = await knex('ha_item_map as m').join('ha_links as l', 'l.id', 'm.link_id').whereIn('m.item_id', itemIds).select('m.*', 'l.entity_id');
  for (const m of maps) {
    if (cfg) await ha(cfg, '/api/services/todo/remove_item', { entity_id: m.entity_id, item: m.ha_uid }).catch(() => {});
  }
  await knex('ha_item_map').whereIn('item_id', itemIds).del();
}

export function startHaPolling() {
  let timer;
  const tick = async () => {
    try {
      const cfg = await haConfig();
      if (cfg) {
        const links = await knex('ha_links').select('id');
        for (const l of links) await syncLink(l.id);
      }
      timer = setTimeout(tick, (cfg?.poll || 30) * 1000);
    } catch (err) {
      console.warn('[ha] Abgleich fehlgeschlagen:', err.message);
      timer = setTimeout(tick, 60000);
    }
  };
  timer = setTimeout(tick, 5000);
  return () => clearTimeout(timer);
}
