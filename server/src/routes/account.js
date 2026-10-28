// Profil, Einstellungen und Administration.
import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { knex } from '../db.js';
import { requireAuth, requireAdmin, publicUser, setSession } from '../auth.js';
import { getSettings, setSetting } from '../settings.js';
import { ah, badRequest, encrypt, decrypt, notFound, toInt } from '../util.js';
import { saveAvatar } from '../services/images.js';
import { aiStatus, testConnection, testClaudeCode, AI_MODELS, CC_MODELS } from '../services/ai.js';
import { haTest } from '../services/homeassistant.js';
import { config } from '../config.js';

const r = express.Router();
r.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ---------- Profil ----------

r.put('/profile', ah(async (req, res) => {
  const upd = {};
  if (req.body.display_name) upd.display_name = String(req.body.display_name).trim().slice(0, 150);
  if (['de', 'en', 'auto'].includes(req.body.locale)) upd.locale = req.body.locale;
  if (['system', 'light', 'dark'].includes(req.body.theme)) upd.theme = req.body.theme;
  if ('email' in req.body) {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw badRequest('Ungültige E-Mail-Adresse');
    const other = await knex('users').whereRaw('LOWER(email) = ?', [email]).whereNot({ id: req.user.id }).first();
    if (other) throw badRequest('E-Mail-Adresse wird bereits verwendet');
    upd.email = email;
  }
  if ('username' in req.body) {
    const un = String(req.body.username || '').trim().slice(0, 100) || null;
    if (un && (await knex('users').where({ username: un }).whereNot({ id: req.user.id }).first())) throw badRequest('Benutzername bereits vergeben');
    upd.username = un;
  }
  if (Object.keys(upd).length) await knex('users').where({ id: req.user.id }).update(upd);
  res.json({ user: publicUser(await knex('users').where({ id: req.user.id }).first()) });
}));

r.post('/profile/avatar', upload.single('file'), ah(async (req, res) => {
  if (!req.file || !/^image\//.test(req.file.mimetype)) throw badRequest('Bitte ein Bild auswählen');
  const rel = await saveAvatar(req.file.buffer);
  await knex('users').where({ id: req.user.id }).update({ avatar: rel });
  res.json({ user: publicUser(await knex('users').where({ id: req.user.id }).first()) });
}));

r.delete('/profile/avatar', ah(async (req, res) => {
  await knex('users').where({ id: req.user.id }).update({ avatar: null });
  res.json({ user: publicUser(await knex('users').where({ id: req.user.id }).first()) });
}));

r.put('/profile/password', ah(async (req, res) => {
  const { current, password } = req.body;
  if (!password || String(password).length < 8) throw badRequest('Das neue Passwort muss mindestens 8 Zeichen lang sein');
  if (req.user.password_hash && !(await bcrypt.compare(String(current || ''), req.user.password_hash))) throw badRequest('Das aktuelle Passwort ist falsch');
  await knex('users').where({ id: req.user.id }).update({ password_hash: await bcrypt.hash(String(password), 11) });
  await knex('users').where({ id: req.user.id }).increment('token_version', 1);
  setSession(res, await knex('users').where({ id: req.user.id }).first());
  res.json({ ok: true });
}));

// ---------- Administration ----------

r.get('/admin/users', requireAdmin, ah(async (req, res) => {
  const rows = await knex('users').select('*',
    knex.raw('(SELECT COUNT(*) FROM recipes r WHERE r.owner_id = users.id AND r.deleted_at IS NULL) as recipe_count')).orderBy('created_at');
  res.json({ items: rows.map((u) => ({ ...publicUser(u), disabled: !!u.disabled, last_login_at: u.last_login_at, recipe_count: Number(u.recipe_count) })) });
}));

r.post('/admin/users', requireAdmin, ah(async (req, res) => {
  const { email, password, display_name, role } = req.body;
  if (!/^\S+@\S+\.\S+$/.test(String(email || ''))) throw badRequest('Ungültige E-Mail-Adresse');
  if (!password || String(password).length < 8) throw badRequest('Passwort mindestens 8 Zeichen');
  if (await knex('users').whereRaw('LOWER(email) = ?', [String(email).toLowerCase()]).first()) throw badRequest('E-Mail bereits registriert');
  const [id] = await knex('users').insert({
    email: String(email).toLowerCase(), display_name: String(display_name || email.split('@')[0]).slice(0, 150),
    password_hash: await bcrypt.hash(String(password), 11), role: role === 'admin' ? 'admin' : 'user',
  });
  res.status(201).json({ id });
}));

r.put('/admin/users/:id', requireAdmin, ah(async (req, res) => {
  const id = toInt(req.params.id);
  const u = await knex('users').where({ id }).first();
  if (!u) throw notFound();
  const upd = {};
  if (['admin', 'user'].includes(req.body.role)) {
    if (id === req.user.id && req.body.role !== 'admin') throw badRequest('Du kannst dir die Admin-Rechte nicht selbst entziehen');
    upd.role = req.body.role;
  }
  if ('disabled' in req.body) {
    if (id === req.user.id) throw badRequest('Du kannst dich nicht selbst deaktivieren');
    upd.disabled = !!req.body.disabled;
    if (upd.disabled) upd.token_version = u.token_version + 1;
  }
  if (req.body.password) {
    if (String(req.body.password).length < 8) throw badRequest('Passwort mindestens 8 Zeichen');
    upd.password_hash = await bcrypt.hash(String(req.body.password), 11);
    upd.token_version = u.token_version + 1;
  }
  await knex('users').where({ id }).update(upd);
  res.json({ ok: true });
}));

r.delete('/admin/users/:id', requireAdmin, ah(async (req, res) => {
  const id = toInt(req.params.id);
  if (id === req.user.id) throw badRequest('Du kannst dich nicht selbst löschen');
  await knex('users').where({ id }).del();
  res.json({ ok: true });
}));

r.get('/admin/settings', requireAdmin, ah(async (req, res) => {
  const s = await getSettings();
  const ccOwner = s.ai.cc_owner_id ? await knex('users').where({ id: s.ai.cc_owner_id }).select('id', 'display_name').first() : null;
  res.json({
    registration_local: !!s.registration_local,
    registration_oidc: !!s.registration_oidc,
    oidc_link_by_email: !!s.oidc_link_by_email,
    oidc_configured: !!(config.oidc.issuer && config.oidc.clientId),
    oidc_issuer: config.oidc.issuer || null,
    oidc_redirect: `${config.appUrl}/api/auth/oidc/callback`,
    ai: {
      ...s.ai, api_key_enc: undefined, cc_token_enc: undefined,
      has_key: !!s.ai.api_key_enc, key_hint: s.ai.api_key_enc ? `…${(decrypt(s.ai.api_key_enc) || '').slice(-4)}` : null, models: AI_MODELS,
      cc_has_token: !!s.ai.cc_token_enc, cc_models: CC_MODELS,
      cc_owner: ccOwner ? { id: ccOwner.id, name: ccOwner.display_name, is_me: ccOwner.id === req.user.id } : null,
    },
    ai_status: await aiStatus(req.user),
    ha: { url: s.ha.url, poll_seconds: s.ha.poll_seconds, has_token: !!s.ha.token_enc },
  });
}));

r.put('/admin/settings', requireAdmin, ah(async (req, res) => {
  const b = req.body;
  for (const k of ['registration_local', 'registration_oidc', 'oidc_link_by_email']) if (k in b) await setSetting(k, !!b[k]);
  if (b.ai) {
    const s = await getSettings();
    const ai = { ...s.ai };
    if ('enabled' in b.ai) ai.enabled = !!b.ai.enabled;
    if ('shared' in b.ai) ai.shared = !!b.ai.shared;
    if (AI_MODELS.includes(b.ai.model)) ai.model = b.ai.model;
    if ('monthly_limit' in b.ai) ai.monthly_limit = Math.max(0, toInt(b.ai.monthly_limit, 0));
    if ('per_user_daily_limit' in b.ai) ai.per_user_daily_limit = Math.max(0, toInt(b.ai.per_user_daily_limit, 0));
    if (b.ai.api_key) {
      const test = await testConnection(String(b.ai.api_key).trim(), ai.model);
      if (!test.ok) throw badRequest(test.error);
      ai.api_key_enc = encrypt(String(b.ai.api_key).trim());
      ai.enabled = true;
    }
    if (b.ai.remove_key) { ai.api_key_enc = null; ai.enabled = false; }
    if (b.ai.cc) {
      const cc = b.ai.cc;
      if (CC_MODELS.includes(cc.model)) ai.cc_model = cc.model;
      if (cc.token) {
        const tkn = String(cc.token).trim();
        if (!/^sk-ant-oat\d*-[\w-]{20,}$/.test(tkn)) throw badRequest('Das sieht nicht wie ein Token aus „claude setup-token“ aus (beginnt mit sk-ant-oat…).');
        // Das Abo gehört der Person, die das Token hinterlegt – nur sie kann den Modus nutzen.
        ai.cc_token_enc = encrypt(tkn);
        ai.cc_owner_id = req.user.id;
        ai.cc_enabled = true;
      }
      if ('enabled' in cc) {
        if (cc.enabled && ai.cc_owner_id !== req.user.id) throw badRequest('Nur die Person, deren Abo hinterlegt ist, kann den Modus einschalten.');
        ai.cc_enabled = !!cc.enabled && !!ai.cc_token_enc;
      }
      if (cc.remove) { ai.cc_token_enc = null; ai.cc_owner_id = null; ai.cc_enabled = false; }
    }
    await setSetting('ai', ai);
  }
  if (b.ha) {
    const s = await getSettings();
    const ha = { ...s.ha };
    if ('url' in b.ha) ha.url = String(b.ha.url || '').trim().replace(/\/$/, '');
    if ('poll_seconds' in b.ha) ha.poll_seconds = Math.max(10, toInt(b.ha.poll_seconds, 30));
    if (b.ha.token) ha.token_enc = encrypt(String(b.ha.token).trim());
    if (b.ha.remove) { ha.url = ''; ha.token_enc = null; }
    if (ha.url && ha.token_enc && (b.ha.token || b.ha.url)) {
      try { await haTest(ha.url, decrypt(ha.token_enc)); } catch (err) { throw badRequest(`Home Assistant nicht erreichbar: ${err.message}`); }
    }
    await setSetting('ha', ha);
  }
  res.json({ ok: true });
}));

r.post('/admin/ai/test-cc', requireAdmin, ah(async (req, res) => {
  const s = await getSettings();
  if (s.ai.cc_owner_id !== req.user.id) throw badRequest('Nur die Person, deren Abo hinterlegt ist, kann es testen.');
  res.json(await testClaudeCode(req.user));
}));

r.post('/admin/ai/test', requireAdmin, ah(async (req, res) => {
  const s = await getSettings();
  const key = decrypt(s.ai.api_key_enc);
  if (!key) throw badRequest('Kein Schlüssel hinterlegt');
  res.json(await testConnection(key, s.ai.model));
}));

export default r;
