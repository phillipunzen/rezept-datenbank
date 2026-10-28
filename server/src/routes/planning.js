// Wochenplan, Einkaufslisten, Vorratsschrank und Vorschläge.
import express from 'express';
import { knex, parseJson, json } from '../db.js';
import { requireAuth } from '../auth.js';
import { assertScope, assertGroupRole, scopeFilter, scopePermission, getRecipeFor, visibleRecipes } from '../access.js';
import { ah, badRequest, notFound, toInt } from '../util.js';
import { notifyScope } from '../events.js';
import { flattenIngredients, mergeItems, aisleFor, parseIngredientLine, ingredientKey, normalizeUnit } from '../services/ingredients.js';
import { imageUrl, thumbUrl } from '../services/images.js';
import { scheduleListSync, removeRemoteForItems, haTodoEntities, syncLink } from '../services/homeassistant.js';
import { serializeCard } from '../services/recipes.js';

const r = express.Router();
r.use(requireAuth);

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

async function scopeTarget(user, body) {
  const groupId = toInt(body.group_id);
  if (groupId) await assertGroupRole(user, groupId, 'editor');
  return groupId || null;
}

// ======================= Wochenplan =======================

function serializeEntry(e) {
  return {
    id: e.id, date: e.date, meal: e.meal, recipe_id: e.recipe_id, title: e.recipe_title || e.title || '',
    servings: e.servings != null ? Number(e.servings) : null, note: e.note || '', sort: e.sort, group_id: e.group_id, owner_id: e.owner_id,
    image_url: thumbUrl(e.recipe_image), total_time: (e.prep_time || 0) + (e.cook_time || 0) || null,
    recipe_servings: e.recipe_servings != null ? Number(e.recipe_servings) : null, thermomix: !!e.thermomix,
  };
}

function planQuery(user, scope) {
  return knex('meal_plan as m').leftJoin('recipes as r', function () {
    this.on('r.id', 'm.recipe_id').andOnNull('r.deleted_at');
  }).where(scopeFilter(user.id, scope, 'm'))
    .select('m.*', 'r.title as recipe_title', 'r.image as recipe_image', 'r.prep_time', 'r.cook_time', 'r.servings as recipe_servings', 'r.thermomix');
}

r.get('/plan', ah(async (req, res) => {
  const { from, to, scope } = req.query;
  if (!isDate(from) || !isDate(to)) throw badRequest('from/to erforderlich');
  const rows = await planQuery(req.user, scope).whereBetween('m.date', [from, to]).orderBy('m.date').orderBy('m.sort').orderBy('m.id');
  res.json({ items: rows.map(serializeEntry) });
}));

r.post('/plan', ah(async (req, res) => {
  const { date, meal } = req.body;
  if (!isDate(date) || !MEALS.includes(meal)) throw badRequest('Datum und Mahlzeit erforderlich');
  const groupId = await scopeTarget(req.user, req.body);
  let recipeId = toInt(req.body.recipe_id);
  let servings = Number(req.body.servings) || null;
  if (recipeId) {
    const { recipe } = await getRecipeFor(req.user, recipeId);
    servings = servings || Number(recipe.servings) || null;
  } else if (!String(req.body.title || '').trim()) throw badRequest('Rezept oder Titel angeben');
  const [id] = await knex('meal_plan').insert({
    owner_id: req.user.id, group_id: groupId, date, meal, recipe_id: recipeId || null,
    title: recipeId ? null : String(req.body.title).slice(0, 255), servings, note: req.body.note || null, created_by: req.user.id,
    sort: toInt(req.body.sort, 0),
  });
  notifyScope({ ownerId: req.user.id, groupId }, { type: 'plan' });
  const row = await planQuery(req.user).where('m.id', id).first();
  res.status(201).json(serializeEntry(row));
}));

async function entryFor(user, id, need = 'edit') {
  const e = await knex('meal_plan').where({ id }).first();
  if (!e) throw notFound();
  await assertScope(user, e, need);
  return e;
}

r.put('/plan/:id', ah(async (req, res) => {
  const e = await entryFor(req.user, toInt(req.params.id));
  const upd = {};
  if (isDate(req.body.date)) upd.date = req.body.date;
  if (MEALS.includes(req.body.meal)) upd.meal = req.body.meal;
  if ('servings' in req.body) upd.servings = Number(req.body.servings) || null;
  if ('note' in req.body) upd.note = req.body.note || null;
  if ('title' in req.body && !e.recipe_id) upd.title = String(req.body.title || '').slice(0, 255);
  if ('sort' in req.body) upd.sort = toInt(req.body.sort, 0);
  if ('recipe_id' in req.body && toInt(req.body.recipe_id)) {
    await getRecipeFor(req.user, toInt(req.body.recipe_id));
    upd.recipe_id = toInt(req.body.recipe_id);
  }
  if ('group_id' in req.body) upd.group_id = await scopeTarget(req.user, req.body);
  if (Object.keys(upd).length) await knex('meal_plan').where({ id: e.id }).update(upd);
  notifyScope({ ownerId: e.owner_id, groupId: e.group_id }, { type: 'plan' });
  if (upd.group_id !== undefined && upd.group_id !== e.group_id) notifyScope({ ownerId: e.owner_id, groupId: upd.group_id }, { type: 'plan' });
  const row = await planQuery(req.user).where('m.id', e.id).first();
  res.json(serializeEntry(row));
}));

r.delete('/plan/:id', ah(async (req, res) => {
  const e = await entryFor(req.user, toInt(req.params.id));
  await knex('meal_plan').where({ id: e.id }).del();
  notifyScope({ ownerId: e.owner_id, groupId: e.group_id }, { type: 'plan' });
  res.json({ ok: true });
}));

// Unterstützung beim Zusammenstellen: Vorschläge für leere Mahlzeiten
r.post('/plan/suggest', ah(async (req, res) => {
  const { from, to, scope } = req.body;
  if (!isDate(from) || !isDate(to)) throw badRequest('Zeitraum erforderlich');
  const meals = (Array.isArray(req.body.meals) ? req.body.meals : ['dinner']).filter((m) => MEALS.includes(m));
  const maxTime = toInt(req.body.max_time);
  const preferPantry = !!req.body.prefer_pantry;
  const category = req.body.category || null;
  const u = req.user;

  const existing = await planQuery(u, scope).whereBetween('m.date', [from, to]);
  const taken = new Set(existing.map((e) => `${e.date}|${e.meal}`));
  const usedRecipes = new Set(existing.map((e) => e.recipe_id).filter(Boolean));

  let q = knex('recipes as r').whereNull('r.deleted_at').where(visibleRecipes(u.id))
    .select('r.*',
      knex.raw('(SELECT 1 FROM recipe_favorites f WHERE f.recipe_id = r.id AND f.user_id = ?) as favorite', [u.id]),
      knex.raw('(SELECT AVG(rating) FROM recipe_ratings rr WHERE rr.recipe_id = r.id) as avg_rating'),
      knex.raw('(SELECT MAX(cooked_at) FROM cook_log cl WHERE cl.recipe_id = r.id) as last_cooked'),
      knex.raw('(SELECT COUNT(*) FROM cook_log cl WHERE cl.recipe_id = r.id) as cook_count'));
  if (maxTime) q = q.whereRaw('(COALESCE(r.prep_time,0)+COALESCE(r.cook_time,0)) <= ?', [maxTime]);
  if (category) q = q.where('r.category', category);
  const recipes = await q;
  if (!recipes.length) return res.json({ items: [] });

  let pantryKeys = [];
  if (preferPantry) {
    const pantry = await knex('pantry_items as p').where(scopeFilter(u.id, scope, 'p'));
    pantryKeys = pantry.map((p) => ingredientKey(p.name)).filter(Boolean);
  }
  const now = Date.now();
  const scored = recipes.map((rc) => {
    let score = Math.random() * 1.5;
    if (rc.favorite) score += 2;
    if (rc.avg_rating) score += Number(rc.avg_rating) * 0.5;
    if (rc.last_cooked) {
      const days = (now - new Date(rc.last_cooked.replace(' ', 'T') + 'Z').getTime()) / 864e5;
      score += days < 7 ? -3 : days < 21 ? -1 : 1;
    } else score += 0.5;
    if (preferPantry) {
      const ings = flattenIngredients(parseJson(rc.ingredients, []));
      const have = ings.filter((i) => pantryKeys.some((k) => matchKey(ingredientKey(i.name), k))).length;
      score += ings.length ? (have / ings.length) * 4 : 0;
    }
    return { rc, score };
  }).sort((a, b) => b.score - a.score);

  const out = [];
  const usedCats = new Map();
  const dates = [];
  for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
  for (const date of dates) {
    for (const meal of meals) {
      if (taken.has(`${date}|${meal}`)) continue;
      // Abwechslung: gleiche Kategorie nicht zu oft, keine Wiederholungen
      const pick = scored.find(({ rc }) => !usedRecipes.has(rc.id) && (usedCats.get(rc.category) || 0) < 2)
        || scored.find(({ rc }) => !usedRecipes.has(rc.id));
      if (!pick) continue;
      usedRecipes.add(pick.rc.id);
      if (pick.rc.category) usedCats.set(pick.rc.category, (usedCats.get(pick.rc.category) || 0) + 1);
      out.push({ date, meal, recipe: serializeCard(pick.rc) });
    }
  }
  res.json({ items: out });
}));

// ======================= Einkaufslisten =======================

async function listFor(user, id, need = 'view') {
  const list = await knex('shopping_lists').where({ id }).first();
  if (!list) throw notFound('Einkaufsliste nicht gefunden');
  const perm = await assertScope(user, list, need);
  return { list, perm };
}

function serializeItem(i) {
  return {
    id: i.id, name: i.name, amount: i.amount != null ? Number(i.amount) : null, unit: i.unit || '', note: i.note || '',
    category: i.category || aisleFor(i.name), checked: !!i.checked, sources: parseJson(i.sources, []) || [], sort: i.sort, updated_at: i.updated_at,
  };
}

async function touch(list, extra = {}) {
  await knex('shopping_lists').where({ id: list.id }).update({ updated_at: knex.fn.now() });
  notifyScope({ ownerId: list.owner_id, groupId: list.group_id }, { type: 'shopping', listId: list.id, ...extra });
  scheduleListSync(list.id).catch(() => {});
}

/** Fügt Einträge hinzu und fasst gleiche, noch offene Zutaten zusammen. */
async function addItems(list, user, items) {
  const existing = await knex('shopping_items').where({ list_id: list.id, checked: false });
  const added = [];
  for (const raw of items) {
    const it = { name: String(raw.name || '').trim().slice(0, 255), amount: raw.amount ?? null, unit: normalizeUnit(raw.unit || ''), note: raw.note || '', sources: raw.sources || [] };
    if (!it.name) continue;
    const match = existing.find((e) => mergeItems([{ name: e.name, unit: e.unit, amount: null }, { name: it.name, unit: it.unit, amount: null }]).length === 1);
    if (match) {
      const merged = mergeItems([
        { name: match.name, unit: match.unit, amount: match.amount, note: match.note, sources: parseJson(match.sources, []) },
        it,
      ])[0];
      await knex('shopping_items').where({ id: match.id }).update({
        amount: match.amount == null && it.amount == null ? null : merged.amount, unit: merged.unit, note: (merged.note || '').slice(0, 255),
        sources: json(merged.sources.slice(-20)), updated_at: knex.fn.now(),
      });
      Object.assign(match, { amount: merged.amount, unit: merged.unit });
      added.push(match.id);
    } else {
      const [id] = await knex('shopping_items').insert({
        list_id: list.id, name: it.name, amount: it.amount, unit: it.unit, note: String(it.note || '').slice(0, 255),
        category: aisleFor(it.name), sources: json(it.sources), created_by: user.id,
      });
      existing.push({ id, ...it, sources: json(it.sources) });
      added.push(id);
    }
  }
  return added;
}

r.get('/shopping', ah(async (req, res) => {
  const rows = await knex('shopping_lists as l').leftJoin('groups as g', 'g.id', 'l.group_id')
    .where(scopeFilter(req.user.id, req.query.scope, 'l'))
    .select('l.*', 'g.name as group_name',
      knex.raw('(SELECT COUNT(*) FROM shopping_items i WHERE i.list_id = l.id AND i.checked = 0) as open_count'),
      knex.raw('(SELECT COUNT(*) FROM shopping_items i WHERE i.list_id = l.id) as total_count'))
    .orderBy('l.updated_at', 'desc');
  res.json({ items: rows.map((l) => ({ ...l, open_count: Number(l.open_count), total_count: Number(l.total_count) })) });
}));

r.post('/shopping', ah(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 150) || 'Einkaufsliste';
  const groupId = await scopeTarget(req.user, req.body);
  const [id] = await knex('shopping_lists').insert({ name, owner_id: req.user.id, group_id: groupId });
  res.status(201).json({ id });
}));

r.get('/shopping/:id', ah(async (req, res) => {
  const { list, perm } = await listFor(req.user, toInt(req.params.id));
  const items = await knex('shopping_items').where({ list_id: list.id }).orderBy('checked').orderBy('sort').orderBy('id');
  const links = await knex('ha_links').where({ list_id: list.id });
  const group = list.group_id ? await knex('groups').where({ id: list.group_id }).select('id', 'name').first() : null;
  res.json({ ...list, perm, group, items: items.map(serializeItem), links });
}));

r.put('/shopping/:id', ah(async (req, res) => {
  const { list } = await listFor(req.user, toInt(req.params.id), 'edit');
  const upd = {};
  if (req.body.name) upd.name = String(req.body.name).slice(0, 150);
  if ('group_id' in req.body) upd.group_id = await scopeTarget(req.user, req.body);
  await knex('shopping_lists').where({ id: list.id }).update(upd);
  await touch({ ...list, ...upd });
  res.json({ ok: true });
}));

r.delete('/shopping/:id', ah(async (req, res) => {
  const { list } = await listFor(req.user, toInt(req.params.id), 'edit');
  await knex('shopping_lists').where({ id: list.id }).del();
  notifyScope({ ownerId: list.owner_id, groupId: list.group_id }, { type: 'shopping', listId: list.id, deleted: true });
  res.json({ ok: true });
}));

r.post('/shopping/:id/items', ah(async (req, res) => {
  const { list } = await listFor(req.user, toInt(req.params.id), 'edit');
  let items = Array.isArray(req.body.items) ? req.body.items : [req.body];
  items = items.map((it) => {
    if (it.text && !it.name) {
      const p = parseIngredientLine(it.text);
      return p ? { ...p, note: p.note || '', sources: [{ type: 'manual' }] } : null;
    }
    return { ...it, amount: it.amount === '' || it.amount == null ? null : Number(it.amount), sources: [{ type: 'manual' }] };
  }).filter(Boolean);
  const ids = await addItems(list, req.user, items);
  await touch(list);
  const rows = await knex('shopping_items').whereIn('id', ids);
  res.status(201).json({ items: rows.map(serializeItem) });
}));

r.put('/shopping/:id/items/:iid', ah(async (req, res) => {
  const { list } = await listFor(req.user, toInt(req.params.id), 'edit');
  const item = await knex('shopping_items').where({ id: toInt(req.params.iid), list_id: list.id }).first();
  if (!item) throw notFound('Eintrag nicht gefunden (evtl. bereits gelöscht)');
  const upd = { updated_at: knex.fn.now() };
  if ('checked' in req.body) { upd.checked = !!req.body.checked; upd.checked_by = req.body.checked ? req.user.id : null; }
  if ('name' in req.body && String(req.body.name).trim()) upd.name = String(req.body.name).trim().slice(0, 255);
  if ('amount' in req.body) upd.amount = req.body.amount === '' || req.body.amount == null ? null : Number(String(req.body.amount).replace(',', '.')) || null;
  if ('unit' in req.body) upd.unit = normalizeUnit(req.body.unit || '');
  if ('note' in req.body) upd.note = String(req.body.note || '').slice(0, 255);
  if ('category' in req.body) upd.category = String(req.body.category || '').slice(0, 50) || null;
  if ('sort' in req.body) upd.sort = toInt(req.body.sort, 0);
  await knex('shopping_items').where({ id: item.id }).update(upd);
  await touch(list);
  res.json(serializeItem(await knex('shopping_items').where({ id: item.id }).first()));
}));

r.delete('/shopping/:id/items/:iid', ah(async (req, res) => {
  const { list } = await listFor(req.user, toInt(req.params.id), 'edit');
  const id = toInt(req.params.iid);
  await removeRemoteForItems([id]).catch(() => {});
  await knex('shopping_items').where({ id, list_id: list.id }).del();
  await touch(list);
  res.json({ ok: true });
}));

r.post('/shopping/:id/clear-checked', ah(async (req, res) => {
  const { list } = await listFor(req.user, toInt(req.params.id), 'edit');
  const ids = (await knex('shopping_items').where({ list_id: list.id, checked: true }).select('id')).map((x) => x.id);
  await removeRemoteForItems(ids).catch(() => {});
  await knex('shopping_items').whereIn('id', ids).del();
  await touch(list);
  res.json({ ok: true, removed: ids.length });
}));

r.post('/shopping/:id/to-pantry', ah(async (req, res) => {
  const { list } = await listFor(req.user, toInt(req.params.id), 'edit');
  const items = await knex('shopping_items').where({ list_id: list.id, checked: true });
  for (const i of items) {
    await knex('pantry_items').insert({ owner_id: req.user.id, group_id: list.group_id, name: i.name, amount: i.amount, unit: i.unit, category: aisleFor(i.name) });
  }
  const ids = items.map((x) => x.id);
  await removeRemoteForItems(ids).catch(() => {});
  await knex('shopping_items').whereIn('id', ids).del();
  await touch(list);
  res.json({ ok: true, moved: ids.length });
}));

// Zutaten eines Rezepts übernehmen
r.post('/shopping/:id/recipe', ah(async (req, res) => {
  const { list } = await listFor(req.user, toInt(req.params.id), 'edit');
  const { recipe } = await getRecipeFor(req.user, toInt(req.body.recipe_id));
  const personal = await knex('recipe_personal').where({ user_id: req.user.id, recipe_id: recipe.id }).first();
  const variant = req.body.use_variant ? parseJson(personal?.variant, null) : null;
  const groups = variant?.ingredients || parseJson(recipe.ingredients, []);
  const baseServings = Number(variant?.servings || recipe.servings) || 1;
  const factor = (Number(req.body.servings) || baseServings) / baseServings;
  let items = flattenIngredients(groups, factor);
  if (Array.isArray(req.body.only)) {
    const keep = new Set(req.body.only.map(String));
    items = items.filter((i) => keep.has(i.name));
  }
  const ids = await addItems(list, req.user, items.map((i) => ({ ...i, sources: [{ type: 'recipe', id: recipe.id, title: recipe.title }] })));
  await touch(list);
  res.json({ ok: true, added: ids.length });
}));

// Aus dem Wochenplan erzeugen
r.post('/plan/shopping', ah(async (req, res) => {
  const { from, to, scope } = req.body;
  if (!isDate(from) || !isDate(to)) throw badRequest('Zeitraum erforderlich');
  let list;
  if (toInt(req.body.list_id)) list = (await listFor(req.user, toInt(req.body.list_id), 'edit')).list;
  else {
    const groupId = /^\d+$/.test(String(scope || '')) ? Number(scope) : null;
    if (groupId) await assertGroupRole(req.user, groupId, 'editor');
    const [id] = await knex('shopping_lists').insert({ name: String(req.body.name || 'Wochenplan').slice(0, 150), owner_id: req.user.id, group_id: groupId });
    list = await knex('shopping_lists').where({ id }).first();
  }
  let entries = await knex('meal_plan as m').join('recipes as r', 'r.id', 'm.recipe_id').whereNull('r.deleted_at')
    .where(scopeFilter(req.user.id, scope, 'm')).whereBetween('m.date', [from, to])
    .select('m.id', 'm.servings', 'r.id as recipe_id', 'r.title', 'r.ingredients', 'r.servings as recipe_servings');
  if (Array.isArray(req.body.entry_ids)) {
    const keep = new Set(req.body.entry_ids.map(Number));
    entries = entries.filter((e) => keep.has(e.id));
  }
  const all = [];
  for (const e of entries) {
    const base = Number(e.recipe_servings) || 1;
    const factor = (Number(e.servings) || base) / base;
    for (const i of flattenIngredients(parseJson(e.ingredients, []), factor)) all.push({ ...i, sources: [{ type: 'recipe', id: e.recipe_id, title: e.title }] });
  }
  // Vorräte optional abziehen (nur Zutaten ohne Mengenvergleich ausblenden)
  let skipped = [];
  if (req.body.skip_pantry) {
    const pantry = await knex('pantry_items as p').where(scopeFilter(req.user.id, scope, 'p'));
    const keys = pantry.map((p) => ingredientKey(p.name));
    const filtered = [];
    for (const i of all) {
      if (keys.some((k) => matchKey(ingredientKey(i.name), k))) skipped.push(i.name); else filtered.push(i);
    }
    all.length = 0;
    all.push(...filtered);
    skipped = [...new Set(skipped)];
  }
  const merged = mergeItems(all);
  const ids = await addItems(list, req.user, merged);
  await touch(list);
  res.json({ list_id: list.id, added: ids.length, recipes: entries.length, skipped_pantry: skipped });
}));

// ---------- Home Assistant ----------

r.get('/ha/entities', ah(async (req, res) => {
  try {
    res.json({ items: await haTodoEntities() });
  } catch (err) {
    throw badRequest(`Home Assistant nicht erreichbar: ${err.message}`);
  }
}));

r.post('/shopping/:id/links', ah(async (req, res) => {
  const { list } = await listFor(req.user, toInt(req.params.id), 'edit');
  const entity = String(req.body.entity_id || '').trim();
  if (!/^todo\.[\w]+$/.test(entity)) throw badRequest('Bitte eine To-do-Liste (todo.…) auswählen');
  if (await knex('ha_links').where({ list_id: list.id, entity_id: entity }).first()) throw badRequest('Bereits verknüpft');
  const [id] = await knex('ha_links').insert({ list_id: list.id, entity_id: entity });
  await syncLink(id);
  res.status(201).json(await knex('ha_links').where({ id }).first());
}));

r.delete('/shopping/:id/links/:lid', ah(async (req, res) => {
  const { list } = await listFor(req.user, toInt(req.params.id), 'edit');
  await knex('ha_links').where({ id: toInt(req.params.lid), list_id: list.id }).del();
  res.json({ ok: true });
}));

r.post('/shopping/:id/sync', ah(async (req, res) => {
  const { list } = await listFor(req.user, toInt(req.params.id));
  const links = await knex('ha_links').where({ list_id: list.id });
  for (const l of links) await syncLink(l.id);
  res.json({ links: await knex('ha_links').where({ list_id: list.id }) });
}));

// ======================= Vorratsschrank =======================

const STAPLES = ['salz', 'pfeffer', 'wasser', 'öl', 'olivenöl', 'zucker', 'salt', 'pepper', 'water', 'oil', 'sugar', 'eiswürfel'];

function matchKey(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const wa = a.split(' ');
  const wb = b.split(' ');
  return wa.some((w) => w.length > 3 && wb.includes(w)) || (b.length > 3 && a.includes(b)) || (a.length > 3 && b.includes(a));
}

r.get('/pantry', ah(async (req, res) => {
  const rows = await knex('pantry_items as p').leftJoin('groups as g', 'g.id', 'p.group_id')
    .where(scopeFilter(req.user.id, req.query.scope, 'p')).select('p.*', 'g.name as group_name').orderBy('p.category').orderBy('p.name');
  res.json({ items: rows.map((p) => ({ ...p, amount: p.amount != null ? Number(p.amount) : null, category: p.category || aisleFor(p.name) })) });
}));

r.post('/pantry', ah(async (req, res) => {
  const groupId = await scopeTarget(req.user, req.body);
  let items = Array.isArray(req.body.items) ? req.body.items : [req.body];
  const ids = [];
  for (let it of items) {
    if (it.text && !it.name) it = { ...it, ...parseIngredientLine(it.text) };
    const name = String(it.name || '').trim().slice(0, 255);
    if (!name) continue;
    const [id] = await knex('pantry_items').insert({
      owner_id: req.user.id, group_id: groupId, name, amount: it.amount === '' || it.amount == null ? null : Number(it.amount),
      unit: normalizeUnit(it.unit || ''), best_before: isDate(it.best_before) ? it.best_before : null, category: aisleFor(name),
    });
    ids.push(id);
  }
  if (!ids.length) throw badRequest('Bitte einen Namen angeben');
  res.status(201).json({ ids });
}));

r.put('/pantry/:id', ah(async (req, res) => {
  const p = await knex('pantry_items').where({ id: toInt(req.params.id) }).first();
  if (!p) throw notFound();
  await assertScope(req.user, p, 'edit');
  const upd = { updated_at: knex.fn.now() };
  if (req.body.name) upd.name = String(req.body.name).slice(0, 255);
  if ('amount' in req.body) upd.amount = req.body.amount === '' || req.body.amount == null ? null : Number(req.body.amount);
  if ('unit' in req.body) upd.unit = normalizeUnit(req.body.unit || '');
  if ('best_before' in req.body) upd.best_before = isDate(req.body.best_before) ? req.body.best_before : null;
  await knex('pantry_items').where({ id: p.id }).update(upd);
  res.json({ ok: true });
}));

r.delete('/pantry/:id', ah(async (req, res) => {
  const p = await knex('pantry_items').where({ id: toInt(req.params.id) }).first();
  if (!p) throw notFound();
  await assertScope(req.user, p, 'edit');
  await knex('pantry_items').where({ id: p.id }).del();
  res.json({ ok: true });
}));

// Was kann ich mit meinen Vorräten kochen?
r.get('/pantry/suggestions', ah(async (req, res) => {
  const pantry = await knex('pantry_items as p').where(scopeFilter(req.user.id, req.query.scope, 'p'));
  const keys = pantry.map((p) => ingredientKey(p.name)).filter(Boolean);
  if (!keys.length) return res.json({ items: [] });
  const recipes = await knex('recipes as r').whereNull('r.deleted_at').where(visibleRecipes(req.user.id)).select('r.*');
  const out = [];
  for (const rc of recipes) {
    const ings = flattenIngredients(parseJson(rc.ingredients, []));
    const relevant = ings.filter((i) => !STAPLES.includes(ingredientKey(i.name)) && !STAPLES.includes(i.name.toLowerCase()));
    if (!relevant.length) continue;
    const have = [];
    const missing = [];
    for (const i of relevant) {
      if (keys.some((k) => matchKey(ingredientKey(i.name), k))) have.push(i.name); else missing.push(i);
    }
    if (!have.length) continue;
    out.push({ recipe: serializeCard(rc), have, missing, score: have.length / relevant.length });
  }
  out.sort((a, b) => b.score - a.score || a.missing.length - b.missing.length);
  res.json({ items: out.slice(0, 40) });
}));

export default r;
