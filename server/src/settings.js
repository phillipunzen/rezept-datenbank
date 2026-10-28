import { knex } from './db.js';

const defaults = {
  registration_local: true,
  registration_oidc: true,
  oidc_link_by_email: true,
  ai: {
    enabled: false, shared: true, model: 'claude-opus-5-5', monthly_limit: 100, per_user_daily_limit: 20, api_key_enc: null,
    // Claude Code mit eigenem Abo – nur für die eigenen Konten in cc_owner_ids nutzbar
    cc_enabled: false, cc_token_enc: null, cc_owner_ids: [], cc_model: 'opus',
  },
  ha: { url: '', token_enc: null, poll_seconds: 30 },
};

let cache = null;

async function load() {
  const rows = await knex('settings').select();
  const out = structuredClone(defaults);
  for (const r of rows) {
    try {
      const v = JSON.parse(r.value);
      out[r.key] = v && typeof v === 'object' && !Array.isArray(v) && out[r.key] && typeof out[r.key] === 'object'
        ? { ...out[r.key], ...v } : v;
    } catch { /* ignore */ }
  }
  cache = out;
  return out;
}

export async function getSettings() {
  return cache || load();
}

export async function setSetting(key, value) {
  const v = JSON.stringify(value);
  await knex.raw('INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)', [key, v]);
  cache = null;
  return load();
}
