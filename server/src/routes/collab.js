// Gruppen (gemeinsame Rezeptbücher/Haushalte) und Rezeptbücher.
import express from 'express';
import { knex } from '../db.js';
import { requireAuth } from '../auth.js';
import { groupRole, assertGroupRole, visibleRecipes } from '../access.js';
import { ah, badRequest, forbidden, notFound, token, toInt } from '../util.js';
import { serializeCard } from '../services/recipes.js';
import { imageUrl } from '../services/images.js';
import { addToCookbook } from './recipes.js';

const r = express.Router();
r.use(requireAuth);

// ---------- Gruppen ----------

r.get('/groups', ah(async (req, res) => {
  const rows = await knex('groups as g').join('group_members as m', 'm.group_id', 'g.id').where('m.user_id', req.user.id)
    .select('g.*', 'm.role',
      knex.raw('(SELECT COUNT(*) FROM group_members x WHERE x.group_id = g.id) as member_count'),
      knex.raw('(SELECT COUNT(*) FROM recipes x WHERE x.group_id = g.id AND x.deleted_at IS NULL) as recipe_count'))
    .orderBy('g.name');
  res.json({ items: rows.map((g) => ({ ...g, member_count: Number(g.member_count), recipe_count: Number(g.recipe_count) })) });
}));

r.post('/groups', ah(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 150);
  if (!name) throw badRequest('Bitte einen Namen angeben');
  const id = await knex.transaction(async (trx) => {
    const [gid] = await trx('groups').insert({ name, description: req.body.description || '', color: req.body.color || null, created_by: req.user.id });
    await trx('group_members').insert({ group_id: gid, user_id: req.user.id, role: 'owner' });
    return gid;
  });
  res.status(201).json({ id });
}));

r.get('/groups/:id', ah(async (req, res) => {
  const id = toInt(req.params.id);
  const role = await groupRole(req.user.id, id);
  if (!role) throw notFound('Gruppe nicht gefunden');
  const g = await knex('groups').where({ id }).first();
  const members = await knex('group_members as m').join('users as u', 'u.id', 'm.user_id').where('m.group_id', id)
    .select('u.id', 'u.display_name', 'u.email', 'u.avatar', 'm.role', 'm.joined_at').orderBy('u.display_name');
  const invites = role === 'owner' ? await knex('group_invites').where({ group_id: id }).select('token', 'role', 'expires_at', 'created_at') : [];
  res.json({
    ...g, role,
    members: members.map((m) => ({ ...m, avatar: m.avatar ? imageUrl(m.avatar) : null })),
    invites,
  });
}));

r.put('/groups/:id', ah(async (req, res) => {
  const id = toInt(req.params.id);
  await assertGroupRole(req.user, id, 'owner');
  await knex('groups').where({ id }).update({
    name: String(req.body.name || '').trim().slice(0, 150) || undefined,
    description: req.body.description ?? undefined,
    color: req.body.color ?? undefined,
  });
  res.json({ ok: true });
}));

r.delete('/groups/:id', ah(async (req, res) => {
  const id = toInt(req.params.id);
  await assertGroupRole(req.user, id, 'owner');
  // Rezepte der Gruppe bleiben bei ihren Eigentümern erhalten (privat)
  await knex('recipes').where({ group_id: id }).update({ group_id: null });
  await knex('groups').where({ id }).del();
  res.json({ ok: true });
}));

r.post('/groups/:id/members', ah(async (req, res) => {
  const id = toInt(req.params.id);
  await assertGroupRole(req.user, id, 'owner');
  const who = String(req.body.user || '').trim().toLowerCase();
  const u = await knex('users').whereRaw('LOWER(email) = ?', [who]).orWhereRaw('LOWER(username) = ?', [who]).first();
  if (!u) throw badRequest('Kein Benutzer gefunden. Tipp: Erstelle einen Einladungslink.');
  const role = ['owner', 'editor', 'viewer'].includes(req.body.role) ? req.body.role : 'editor';
  await knex.raw('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)', [id, u.id, role]);
  res.status(201).json({ ok: true });
}));

r.put('/groups/:id/members/:uid', ah(async (req, res) => {
  const id = toInt(req.params.id);
  await assertGroupRole(req.user, id, 'owner');
  const role = ['owner', 'editor', 'viewer'].includes(req.body.role) ? req.body.role : 'editor';
  const uid = toInt(req.params.uid);
  if (role !== 'owner') {
    const owners = await knex('group_members').where({ group_id: id, role: 'owner' }).whereNot({ user_id: uid });
    if (!owners.length) throw badRequest('Eine Gruppe braucht mindestens einen Eigentümer');
  }
  await knex('group_members').where({ group_id: id, user_id: uid }).update({ role });
  res.json({ ok: true });
}));

r.delete('/groups/:id/members/:uid', ah(async (req, res) => {
  const id = toInt(req.params.id);
  const uid = toInt(req.params.uid);
  if (uid !== req.user.id) await assertGroupRole(req.user, id, 'owner');
  const owners = await knex('group_members').where({ group_id: id, role: 'owner' }).whereNot({ user_id: uid });
  const target = await knex('group_members').where({ group_id: id, user_id: uid }).first();
  if (target?.role === 'owner' && !owners.length) throw badRequest('Bitte zuerst einen anderen Eigentümer bestimmen oder die Gruppe löschen');
  await knex('group_members').where({ group_id: id, user_id: uid }).del();
  res.json({ ok: true });
}));

r.post('/groups/:id/invites', ah(async (req, res) => {
  const id = toInt(req.params.id);
  await assertGroupRole(req.user, id, 'owner');
  const t = token(18);
  const role = ['editor', 'viewer'].includes(req.body.role) ? req.body.role : 'editor';
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * (toInt(req.body.days, 7) || 7));
  await knex('group_invites').insert({ token: t, group_id: id, role, created_by: req.user.id, expires_at: expires.toISOString().slice(0, 19).replace('T', ' ') });
  res.status(201).json({ token: t });
}));

r.delete('/groups/:id/invites/:token', ah(async (req, res) => {
  await assertGroupRole(req.user, toInt(req.params.id), 'owner');
  await knex('group_invites').where({ token: req.params.token, group_id: toInt(req.params.id) }).del();
  res.json({ ok: true });
}));

r.get('/invites/:token', ah(async (req, res) => {
  const inv = await knex('group_invites as i').join('groups as g', 'g.id', 'i.group_id').where('i.token', req.params.token)
    .select('i.*', 'g.name').first();
  if (!inv || (inv.expires_at && new Date(inv.expires_at.replace(' ', 'T') + 'Z') < new Date())) throw notFound('Einladung ungültig oder abgelaufen');
  const member = await groupRole(req.user.id, inv.group_id);
  res.json({ group_id: inv.group_id, name: inv.name, role: inv.role, member: !!member });
}));

r.post('/invites/:token/accept', ah(async (req, res) => {
  const inv = await knex('group_invites').where({ token: req.params.token }).first();
  if (!inv || (inv.expires_at && new Date(inv.expires_at.replace(' ', 'T') + 'Z') < new Date())) throw notFound('Einladung ungültig oder abgelaufen');
  await knex.raw('INSERT IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)', [inv.group_id, req.user.id, inv.role]);
  res.json({ group_id: inv.group_id });
}));

r.get('/users/search', ah(async (req, res) => {
  // Nur Benutzer aus gemeinsamen Gruppen werden vorgeschlagen (keine Benutzerliste für alle).
  const q = `%${String(req.query.q || '').trim()}%`;
  const rows = await knex('users as u').join('group_members as m', 'm.user_id', 'u.id')
    .whereIn('m.group_id', knex('group_members').where('user_id', req.user.id).select('group_id'))
    .whereNot('u.id', req.user.id)
    .where(function () { this.where('u.display_name', 'like', q).orWhere('u.email', 'like', q).orWhere('u.username', 'like', q); })
    .distinct('u.id', 'u.display_name', 'u.email', 'u.username').limit(10);
  res.json({ items: rows });
}));

// ---------- Rezeptbücher ----------

async function cookbookFor(user, id, need = 'view') {
  const cb = await knex('cookbooks').where({ id }).first();
  if (!cb) throw notFound('Rezeptbuch nicht gefunden');
  if (cb.group_id) {
    const role = await groupRole(user.id, cb.group_id);
    if (!role) throw notFound('Rezeptbuch nicht gefunden');
    if (need === 'edit' && role === 'viewer') throw forbidden('Nur Lesezugriff');
    return { cb, canEdit: role !== 'viewer' };
  }
  if (cb.owner_id !== user.id) throw notFound('Rezeptbuch nicht gefunden');
  return { cb, canEdit: true };
}

r.get('/cookbooks', ah(async (req, res) => {
  const u = req.user;
  const rows = await knex('cookbooks as c').leftJoin('groups as g', 'g.id', 'c.group_id')
    .where(function () {
      this.where(function () { this.whereNull('c.group_id').andWhere('c.owner_id', u.id); })
        .orWhereIn('c.group_id', knex('group_members').where('user_id', u.id).select('group_id'));
    })
    .select('c.*', 'g.name as group_name',
      knex.raw('(SELECT COUNT(*) FROM cookbook_recipes cr JOIN recipes rr ON rr.id = cr.recipe_id WHERE cr.cookbook_id = c.id AND rr.deleted_at IS NULL) as recipe_count'))
    .orderBy('c.name');
  const covers = await knex('cookbook_recipes as cr').join('recipes as r', 'r.id', 'cr.recipe_id')
    .whereIn('cr.cookbook_id', rows.map((x) => x.id)).whereNull('r.deleted_at').whereNotNull('r.image')
    .select('cr.cookbook_id', 'r.image').orderBy('cr.added_at', 'desc');
  const coverMap = new Map();
  for (const c of covers) {
    if (!coverMap.has(c.cookbook_id)) coverMap.set(c.cookbook_id, []);
    const arr = coverMap.get(c.cookbook_id);
    if (arr.length < 4) arr.push(imageUrl(c.image.replace(/\.webp$/, '.thumb.webp')));
  }
  res.json({ items: rows.map((c) => ({ ...c, recipe_count: Number(c.recipe_count), covers: coverMap.get(c.id) || [] })) });
}));

r.post('/cookbooks', ah(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 150);
  if (!name) throw badRequest('Bitte einen Namen angeben');
  const groupId = toInt(req.body.group_id);
  if (groupId) await assertGroupRole(req.user, groupId, 'editor');
  const [id] = await knex('cookbooks').insert({ name, description: req.body.description || '', color: req.body.color || null, icon: req.body.icon || null, owner_id: req.user.id, group_id: groupId || null });
  res.status(201).json({ id });
}));

r.get('/cookbooks/:id', ah(async (req, res) => {
  const { cb, canEdit } = await cookbookFor(req.user, toInt(req.params.id));
  const group = cb.group_id ? await knex('groups').where({ id: cb.group_id }).select('id', 'name').first() : null;
  res.json({ ...cb, can_edit: canEdit, group });
}));

r.put('/cookbooks/:id', ah(async (req, res) => {
  const { cb } = await cookbookFor(req.user, toInt(req.params.id), 'edit');
  const groupId = 'group_id' in req.body ? toInt(req.body.group_id) : cb.group_id;
  if (groupId && groupId !== cb.group_id) await assertGroupRole(req.user, groupId, 'editor');
  await knex('cookbooks').where({ id: cb.id }).update({
    name: String(req.body.name ?? cb.name).trim().slice(0, 150) || cb.name,
    description: req.body.description ?? cb.description,
    color: req.body.color ?? cb.color,
    icon: req.body.icon ?? cb.icon,
    group_id: groupId || null,
  });
  res.json({ ok: true });
}));

r.delete('/cookbooks/:id', ah(async (req, res) => {
  const { cb } = await cookbookFor(req.user, toInt(req.params.id), 'edit');
  await knex('cookbooks').where({ id: cb.id }).del();
  res.json({ ok: true });
}));

r.post('/cookbooks/:id/recipes', ah(async (req, res) => {
  const ids = [].concat(req.body.recipe_id || req.body.recipe_ids || []).map(Number).filter(Boolean);
  for (const rid of ids) await addToCookbook(req.user, toInt(req.params.id), rid);
  res.status(201).json({ ok: true });
}));

r.delete('/cookbooks/:id/recipes/:rid', ah(async (req, res) => {
  const { cb } = await cookbookFor(req.user, toInt(req.params.id), 'edit');
  await knex('cookbook_recipes').where({ cookbook_id: cb.id, recipe_id: toInt(req.params.rid) }).del();
  res.json({ ok: true });
}));

// Rezept-IDs, die über das Rezeptbuch sichtbar sind (für Detailseite verwendet die normale Rezeptliste mit ?cookbook=)
r.get('/cookbooks/:id/recipes', ah(async (req, res) => {
  const { cb } = await cookbookFor(req.user, toInt(req.params.id));
  const rows = await knex('recipes as r').join('cookbook_recipes as cr', 'cr.recipe_id', 'r.id')
    .where('cr.cookbook_id', cb.id).whereNull('r.deleted_at').where(visibleRecipes(req.user.id)).select('r.*').orderBy('r.title');
  res.json({ items: rows.map(serializeCard) });
}));

export default r;
