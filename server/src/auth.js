import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { knex } from './db.js';
import { HttpError } from './util.js';

const COOKIE = 'rb_session';
const MAX_AGE = 1000 * 60 * 60 * 24 * 60; // 60 Tage

export function setSession(res, user) {
  const t = jwt.sign({ uid: user.id, tv: user.token_version }, config.secret, { expiresIn: '60d' });
  res.cookie(COOKIE, t, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: MAX_AGE,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    display_name: u.display_name,
    role: u.role,
    locale: u.locale,
    theme: u.theme,
    avatar: u.avatar ? `/uploads/${u.avatar}` : null,
    has_password: !!u.password_hash,
    oidc: !!u.oidc_sub,
    created_at: u.created_at,
  };
}

// Lädt den Benutzer aus dem Cookie (falls vorhanden) – blockiert nicht.
export async function loadUser(req, _res, next) {
  const t = req.cookies?.[COOKIE];
  if (!t) return next();
  try {
    const p = jwt.verify(t, config.secret);
    const u = await knex('users').where({ id: p.uid }).first();
    if (u && !u.disabled && u.token_version === p.tv) req.user = u;
  } catch { /* ungültig */ }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Bitte anmelden', 'unauthorized'));
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Bitte anmelden', 'unauthorized'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Nur für Administratoren', 'forbidden'));
  next();
}
