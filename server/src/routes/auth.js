import express from 'express';
import bcrypt from 'bcryptjs';
import { Issuer, generators } from 'openid-client';
import { knex } from '../db.js';
import { config } from '../config.js';
import { getSettings } from '../settings.js';
import { setSession, clearSession, publicUser, requireAuth } from '../auth.js';
import { ah, badRequest, HttpError } from '../util.js';

const r = express.Router();

let oidcClient = null;
async function getOidc() {
  if (!config.oidc.issuer || !config.oidc.clientId) return null;
  if (oidcClient) return oidcClient;
  const issuer = await Issuer.discover(config.oidc.issuer);
  oidcClient = new issuer.Client({
    client_id: config.oidc.clientId,
    client_secret: config.oidc.clientSecret,
    redirect_uris: [`${config.appUrl}/api/auth/oidc/callback`],
    response_types: ['code'],
  });
  return oidcClient;
}

async function userCount() {
  const [{ c }] = await knex('users').count({ c: '*' });
  return Number(c);
}

r.get('/config', ah(async (req, res) => {
  const s = await getSettings();
  const first = (await userCount()) === 0;
  res.json({
    registration: first || !!s.registration_local,
    first_user: first,
    oidc: config.oidc.issuer && config.oidc.clientId ? { name: config.oidc.name, registration: !!s.registration_oidc } : null,
  });
}));

r.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

r.post('/register', ah(async (req, res) => {
  const s = await getSettings();
  const first = (await userCount()) === 0;
  if (!first && !s.registration_local) throw new HttpError(403, 'Die Registrierung ist deaktiviert', 'registration_closed');
  const { email, password, display_name, username, locale } = req.body || {};
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw badRequest('Bitte eine gültige E-Mail-Adresse angeben');
  if (!password || String(password).length < 8) throw badRequest('Das Passwort muss mindestens 8 Zeichen lang sein');
  const exists = await knex('users').whereRaw('LOWER(email) = ?', [String(email).toLowerCase()]).first();
  if (exists) throw badRequest('Diese E-Mail-Adresse ist bereits registriert');
  const uname = username ? String(username).trim().slice(0, 100) : null;
  if (uname && (await knex('users').where({ username: uname }).first())) throw badRequest('Benutzername bereits vergeben');
  const [id] = await knex('users').insert({
    email: String(email).toLowerCase().trim(),
    username: uname,
    display_name: String(display_name || email.split('@')[0]).slice(0, 150),
    password_hash: await bcrypt.hash(String(password), 11),
    role: first ? 'admin' : 'user',
    locale: ['de', 'en'].includes(locale) ? locale : 'auto',
  });
  const user = await knex('users').where({ id }).first();
  setSession(res, user);
  res.json({ user: publicUser(user) });
}));

r.post('/login', ah(async (req, res) => {
  const { login, password } = req.body || {};
  const l = String(login || '').toLowerCase().trim();
  const user = await knex('users').whereRaw('LOWER(email) = ?', [l]).orWhere('username', String(login || '').trim()).first();
  if (!user || !user.password_hash || !(await bcrypt.compare(String(password || ''), user.password_hash))) {
    throw new HttpError(401, 'E-Mail/Benutzername oder Passwort ist falsch', 'invalid_login');
  }
  if (user.disabled) throw new HttpError(403, 'Dieses Konto ist deaktiviert', 'disabled');
  await knex('users').where({ id: user.id }).update({ last_login_at: knex.fn.now() });
  setSession(res, user);
  res.json({ user: publicUser(user) });
}));

r.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

r.post('/logout-all', requireAuth, ah(async (req, res) => {
  await knex('users').where({ id: req.user.id }).increment('token_version', 1);
  clearSession(res);
  res.json({ ok: true });
}));

// ---------- OIDC / Authentik ----------

r.get('/oidc/start', ah(async (req, res) => {
  const client = await getOidc();
  if (!client) throw badRequest('Authentik ist nicht konfiguriert');
  const state = generators.state();
  const nonce = generators.nonce();
  const verifier = generators.codeVerifier();
  const opts = { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: 10 * 60 * 1000, path: '/api/auth/oidc' };
  res.cookie('rb_oidc', JSON.stringify({ state, nonce, verifier, link: req.query.link === '1' }), opts);
  res.redirect(client.authorizationUrl({
    scope: config.oidc.scopes,
    state,
    nonce,
    code_challenge: generators.codeChallenge(verifier),
    code_challenge_method: 'S256',
  }));
}));

r.get('/oidc/callback', async (req, res) => {
  const fail = (msg) => res.redirect(`/login?error=${encodeURIComponent(msg)}`);
  try {
    const client = await getOidc();
    const stored = JSON.parse(req.cookies.rb_oidc || '{}');
    res.clearCookie('rb_oidc', { path: '/api/auth/oidc' });
    if (!client || !stored.state) return fail('Anmeldung abgelaufen – bitte erneut versuchen');
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(`${config.appUrl}/api/auth/oidc/callback`, params, {
      state: stored.state, nonce: stored.nonce, code_verifier: stored.verifier,
    });
    const claims = { ...tokenSet.claims(), ...(await client.userinfo(tokenSet).catch(() => ({}))) };
    const sub = String(claims.sub);
    const email = claims.email ? String(claims.email).toLowerCase() : null;
    const s = await getSettings();
    const groups = Array.isArray(claims.groups) ? claims.groups : [];
    const isAdminGroup = config.oidc.adminGroup && groups.includes(config.oidc.adminGroup);

    // Bestehendes Konto verknüpfen (angemeldeter Benutzer)
    if (stored.link && req.user) {
      const other = await knex('users').where({ oidc_sub: sub }).whereNot({ id: req.user.id }).first();
      if (other) return res.redirect('/settings?error=' + encodeURIComponent('Dieses Authentik-Konto ist bereits mit einem anderen Benutzer verknüpft'));
      await knex('users').where({ id: req.user.id }).update({ oidc_sub: sub });
      return res.redirect('/settings?linked=1');
    }

    let user = await knex('users').where({ oidc_sub: sub }).first();
    if (!user && email && s.oidc_link_by_email) {
      user = await knex('users').whereRaw('LOWER(email) = ?', [email]).first();
      if (user) await knex('users').where({ id: user.id }).update({ oidc_sub: sub });
    }
    if (!user) {
      const first = (await userCount()) === 0;
      if (!first && !s.registration_oidc) return fail('Für dieses Authentik-Konto ist kein Benutzer freigeschaltet');
      let username = claims.preferred_username ? String(claims.preferred_username).slice(0, 100) : null;
      if (username && (await knex('users').where({ username }).first())) username = null;
      const [id] = await knex('users').insert({
        email,
        username,
        display_name: String(claims.name || claims.preferred_username || email || 'Benutzer').slice(0, 150),
        oidc_sub: sub,
        role: first || isAdminGroup ? 'admin' : 'user',
        locale: 'auto',
      });
      user = await knex('users').where({ id }).first();
    } else if (isAdminGroup && user.role !== 'admin') {
      await knex('users').where({ id: user.id }).update({ role: 'admin' });
      user.role = 'admin';
    }
    if (user.disabled) return fail('Dieses Konto ist deaktiviert');
    await knex('users').where({ id: user.id }).update({ last_login_at: knex.fn.now() });
    setSession(res, user);
    res.redirect('/');
  } catch (err) {
    console.warn('[oidc]', err.message);
    fail('Anmeldung über Authentik fehlgeschlagen');
  }
});

export default r;
