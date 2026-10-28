import express from 'express';
import multer from 'multer';
import { knex, parseJson, json } from '../db.js';
import { requireAuth } from '../auth.js';
import { visibleRecipes, getRecipeFor, assertGroupRole, memberships } from '../access.js';
import { ah, badRequest, notFound, token, toInt } from '../util.js';
import {
  createRecipe, updateRecipe, serializeRecipe, serializeCard, snapshotOf, saveVersion, uniqueSlug,
} from '../services/recipes.js';
import { saveImage, imageUrl } from '../services/images.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { uploadsDir } from '../config.js';

const r = express.Router();
r.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });

// ---------- Bilder ----------

r.post('/uploads/image', upload.array('files', 10), ah(async (req, res) => {
  if (!req.files?.length) throw badRequest('Keine Datei empfangen');
  const out = [];
  for (const f of req.files) {
    if (!/^image\//.test(f.mimetype)) throw badRequest('Nur Bilddateien sind erlaubt');
    const rel = await saveImage(f.buffer);
    out.push({ path: rel, url: imageUrl(rel) });
  }
  res.json({ images: out });
}));

// ---------- Liste & Suche ----------

function baseQuery(user) {
  return knex('recipes as r')
    .whereNull('r.deleted_at')
    .where(visibleRecipes(user.id))
    .leftJoin('recipe_favorites as f', function () {
      this.on('f.recipe_id', 'r.id').andOn('f.user_id', knex.raw('?', [user.id]));
    });
}

const cardColumns = (user) => [
  'r.id', 'r.title', 'r.description', 'r.image', 'r.prep_time', 'r.cook_time', 'r.rest_time', 'r.category', 'r.tags',
  'r.thermomix', 'r.is_public', 'r.group_id', 'r.owner_id', 'r.servings', 'r.updated_at', 'r.created_at',
  knex.raw('f.user_id IS NOT NULL as favorite'),
  knex.raw('(SELECT AVG(rating) FROM recipe_ratings rr WHERE rr.recipe_id = r.id) as avg_rating'),
  knex.raw('(SELECT MAX(cooked_at) FROM cook_log cl WHERE cl.recipe_id = r.id AND cl.user_id = ?) as last_cooked', [user.id]),
];

r.get('/recipes', ah(async (req, res) => {
  const u = req.user;
  const { q, category, tag, favorites, cookbook, scope, thermomix, max_time, min_rating, sort, ids, ingredient } = req.query;
  const limit = Math.min(toInt(req.query.limit, 48), 200);
  const page = Math.max(toInt(req.query.page, 1), 1);
  let qb = baseQuery(u);
  if (q) {
    for (const word of String(q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) {
      qb = qb.where('r.search_text', 'like', `%${word}%`);
    }
  }
  if (ingredient) qb = qb.where('r.ingredients', 'like', `%${String(ingredient).replace(/[%_]/g, '')}%`);
  if (category) qb = qb.where('r.category', category);
  if (tag) for (const t of [].concat(tag)) qb = qb.whereRaw('JSON_CONTAINS(r.tags, ?)', [JSON.stringify(t)]);
  if (favorites === '1') qb = qb.whereNotNull('f.user_id');
  if (thermomix === '1') qb = qb.where('r.thermomix', true);
  if (ids) qb = qb.whereIn('r.id', String(ids).split(',').map(Number).filter(Boolean));
  if (max_time) qb = qb.whereRaw('(COALESCE(r.prep_time,0)+COALESCE(r.cook_time,0)+COALESCE(r.rest_time,0)) <= ?', [toInt(max_time, 9999)]);
  if (cookbook) qb = qb.whereIn('r.id', knex('cookbook_recipes').where('cookbook_id', toInt(cookbook)).select('recipe_id'));
  if (scope === 'mine') qb = qb.where('r.owner_id', u.id).whereNull('r.group_id');
  else if (scope === 'shared') qb = qb.whereNot('r.owner_id', u.id);
  else if (scope && /^\d+$/.test(scope)) qb = qb.where('r.group_id', Number(scope));
  if (min_rating) qb = qb.whereRaw('(SELECT AVG(rating) FROM recipe_ratings rr WHERE rr.recipe_id = r.id) >= ?', [Number(min_rating)]);

  const [{ total }] = await qb.clone().clearSelect().count({ total: 'r.id' });
  const order = {
    title: [['r.title', 'asc']],
    rating: [[knex.raw('avg_rating'), 'desc']],
    cooked: [[knex.raw('last_cooked'), 'desc']],
    created: [['r.created_at', 'desc']],
    time: [[knex.raw('(COALESCE(r.prep_time,0)+COALESCE(r.cook_time,0)+COALESCE(r.rest_time,0))'), 'asc']],
  }[sort] || [['r.updated_at', 'desc']];
  let rows = qb.select(cardColumns(u));
  for (const [col, dir] of order) rows = rows.orderBy(col, dir);
  rows = await rows.orderBy('r.id', 'desc').limit(limit).offset((page - 1) * limit);
  res.json({ total: Number(total), page, limit, items: rows.map(serializeCard) });
}));

r.get('/recipes/meta', ah(async (req, res) => {
  const rows = await baseQuery(req.user).select('r.category', 'r.tags');
  const cats = new Map();
  const tags = new Map();
  for (const row of rows) {
    if (row.category) cats.set(row.category, (cats.get(row.category) || 0) + 1);
    for (const t of parseJson(row.tags, []) || []) tags.set(t, (tags.get(t) || 0) + 1);
  }
  const sorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  res.json({ categories: sorted(cats), tags: sorted(tags) });
}));

r.get('/home', ah(async (req, res) => {
  const u = req.user;
  const today = /^\d{4}-\d{2}-\d{2}$/.test(req.query.today || '') ? req.query.today : new Date().toISOString().slice(0, 10);
  const meals = await knex('meal_plan as m')
    .leftJoin('recipes as r', 'r.id', 'm.recipe_id')
    .where('m.date', today)
    .where(function () {
      this.where(function () { this.whereNull('m.group_id').andWhere('m.owner_id', u.id); })
        .orWhereIn('m.group_id', knex('group_members').where('user_id', u.id).select('group_id'));
    })
    .select('m.*', 'r.title as recipe_title', 'r.image as recipe_image', 'r.prep_time', 'r.cook_time');
  const favs = await baseQuery(u).whereNotNull('f.user_id').select(cardColumns(u)).orderBy('f.created_at', 'desc').limit(12);
  const recent = await baseQuery(u)
    .whereIn('r.id', knex('cook_log').where('user_id', u.id).select('recipe_id'))
    .select(cardColumns(u)).orderBy(knex.raw('last_cooked'), 'desc').limit(12);
  const latest = await baseQuery(u).select(cardColumns(u)).orderBy('r.created_at', 'desc').limit(8);
  const [{ count }] = await baseQuery(u).count({ count: 'r.id' });
  const ORDER = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
  res.json({
    today,
    meals: meals.sort((a, b) => ORDER[a.meal] - ORDER[b.meal]).map((m) => ({
      id: m.id, meal: m.meal, recipe_id: m.recipe_id, title: m.recipe_title || m.title, servings: m.servings != null ? Number(m.servings) : null,
      image_url: m.recipe_image ? imageUrl(m.recipe_image.replace(/\.webp$/, '.thumb.webp')) : null, group_id: m.group_id,
    })),
    favorites: favs.map(serializeCard),
    recent: recent.map(serializeCard),
    latest: latest.map(serializeCard),
    recipe_count: Number(count),
  });
}));

// ---------- Einzelnes Rezept ----------

async function fullRecipe(user, recipe, perm) {
  const [fav, rating, personal, ratingAgg, books, log, owner, group] = await Promise.all([
    knex('recipe_favorites').where({ user_id: user.id, recipe_id: recipe.id }).first(),
    knex('recipe_ratings').where({ user_id: user.id, recipe_id: recipe.id }).first(),
    knex('recipe_personal').where({ user_id: user.id, recipe_id: recipe.id }).first(),
    knex('recipe_ratings').where({ recipe_id: recipe.id }).avg({ avg: 'rating' }).count({ count: '*' }).first(),
    knex('cookbook_recipes as cr').join('cookbooks as c', 'c.id', 'cr.cookbook_id').where('cr.recipe_id', recipe.id)
      .where(function () {
        this.where(function () { this.whereNull('c.group_id').andWhere('c.owner_id', user.id); })
          .orWhereIn('c.group_id', knex('group_members').where('user_id', user.id).select('group_id'));
      }).select('c.id', 'c.name', 'c.color'),
    knex('cook_log as l').join('users as u', 'u.id', 'l.user_id').where('l.recipe_id', recipe.id)
      .where(function () { this.where('l.user_id', user.id).orWhereNotNull('l.notes'); })
      .select('l.*', 'u.display_name').orderBy('l.cooked_at', 'desc').limit(30),
    knex('users').where({ id: recipe.owner_id }).select('id', 'display_name').first(),
    recipe.group_id ? knex('groups').where({ id: recipe.group_id }).select('id', 'name').first() : null,
  ]);
  const s = serializeRecipe(recipe, {
    perm,
    favorite: !!fav,
    my_rating: rating?.rating || null,
    avg_rating: ratingAgg?.avg != null ? Math.round(Number(ratingAgg.avg) * 10) / 10 : null,
    rating_count: Number(ratingAgg?.count || 0),
    personal: {
      note: personal?.note || '',
      variant: parseJson(personal?.variant, null),
      offline: !!personal?.offline,
    },
    cookbooks: books,
    cook_log: log.map((l) => ({
      id: l.id, cooked_at: l.cooked_at, servings: l.servings != null ? Number(l.servings) : null, notes: l.notes, rating: l.rating,
      user: l.display_name, mine: l.user_id === user.id,
    })),
    owner: owner ? { id: owner.id, name: owner.display_name } : null,
    group: group || null,
  });
  // Quellenangaben sind interne Angaben – für reine Betrachter ohne Bearbeitungsrecht trotzdem sichtbar (intern),
  // aber niemals in öffentlichen Ansichten.
  return s;
}

r.post('/recipes', ah(async (req, res) => {
  const groupId = toInt(req.body.group_id);
  if (groupId) await assertGroupRole(req.user, groupId, 'editor');
  const id = await createRecipe(req.user, req.body, { groupId, changeNote: req.body.change_note || 'Erstellt' });
  const cookbookIds = Array.isArray(req.body.cookbook_ids) ? req.body.cookbook_ids : [];
  for (const cb of cookbookIds) await addToCookbook(req.user, toInt(cb), id).catch(() => {});
  const recipe = await knex('recipes').where({ id }).first();
  res.status(201).json(await fullRecipe(req.user, recipe, 'owner'));
}));

r.get('/recipes/:id', ah(async (req, res) => {
  const { recipe, perm } = await getRecipeFor(req.user, toInt(req.params.id));
  res.json(await fullRecipe(req.user, recipe, perm));
}));

r.put('/recipes/:id', ah(async (req, res) => {
  const id = toInt(req.params.id);
  const { recipe } = await getRecipeFor(req.user, id, 'edit');
  if (recipe.deleted_at) throw badRequest('Rezept liegt im Papierkorb');
  await updateRecipe(req.user, id, req.body, req.body.change_note || 'Bearbeitet');
  const { recipe: fresh, perm } = await getRecipeFor(req.user, id);
  res.json(await fullRecipe(req.user, fresh, perm));
}));

r.post('/recipes/:id/duplicate', ah(async (req, res) => {
  const { recipe } = await getRecipeFor(req.user, toInt(req.params.id));
  const snap = snapshotOf(recipe);
  // Bilder werden geteilt referenziert (gleiche Dateien)
  const newId = await createRecipe(req.user, { ...snap, title: `${snap.title} (Kopie)` }, { changeNote: `Kopie von „${recipe.title}“` });
  res.status(201).json({ id: newId });
}));

r.delete('/recipes/:id', ah(async (req, res) => {
  const { recipe, perm } = await getRecipeFor(req.user, toInt(req.params.id), 'edit');
  if (perm !== 'owner' && !recipe.group_id) throw badRequest('Nur der Eigentümer kann dieses Rezept löschen');
  await knex('recipes').where({ id: recipe.id }).update({ deleted_at: knex.fn.now(), is_public: false });
  res.json({ ok: true });
}));

r.get('/trash', ah(async (req, res) => {
  const rows = await knex('recipes as r')
    .whereNotNull('r.deleted_at')
    .where(function () {
      this.where('r.owner_id', req.user.id).orWhereIn('r.group_id',
        knex('group_members').where('user_id', req.user.id).whereIn('role', ['owner', 'editor']).select('group_id'));
    })
    .select('r.*').orderBy('r.deleted_at', 'desc');
  res.json({ items: rows.map(serializeCard) });
}));

async function trashAccess(user, id) {
  const recipe = await knex('recipes').where({ id }).whereNotNull('deleted_at').first();
  if (!recipe) throw notFound();
  if (recipe.owner_id === user.id) return recipe;
  if (recipe.group_id) {
    const m = await knex('group_members').where({ user_id: user.id, group_id: recipe.group_id }).whereIn('role', ['owner', 'editor']).first();
    if (m) return recipe;
  }
  throw notFound();
}

r.post('/recipes/:id/restore', ah(async (req, res) => {
  const recipe = await trashAccess(req.user, toInt(req.params.id));
  await knex('recipes').where({ id: recipe.id }).update({ deleted_at: null });
  res.json({ ok: true });
}));

r.delete('/recipes/:id/permanent', ah(async (req, res) => {
  const recipe = await trashAccess(req.user, toInt(req.params.id));
  await knex('meal_plan').where({ recipe_id: recipe.id }).update({ recipe_id: null, title: recipe.title });
  await knex('recipes').where({ id: recipe.id }).del();
  res.json({ ok: true });
}));

r.post('/trash/empty', ah(async (req, res) => {
  const rows = await knex('recipes').whereNotNull('deleted_at').where('owner_id', req.user.id).select('id', 'title');
  for (const row of rows) await knex('meal_plan').where({ recipe_id: row.id }).update({ recipe_id: null, title: row.title });
  await knex('recipes').whereIn('id', rows.map((x) => x.id)).del();
  res.json({ ok: true, deleted: rows.length });
}));

// ---------- Persönliches ----------

r.put('/recipes/:id/favorite', ah(async (req, res) => {
  const { recipe } = await getRecipeFor(req.user, toInt(req.params.id));
  if (req.body.favorite) {
    await knex.raw('INSERT IGNORE INTO recipe_favorites (user_id, recipe_id) VALUES (?, ?)', [req.user.id, recipe.id]);
  } else {
    await knex('recipe_favorites').where({ user_id: req.user.id, recipe_id: recipe.id }).del();
  }
  res.json({ favorite: !!req.body.favorite });
}));

r.put('/recipes/:id/rating', ah(async (req, res) => {
  const { recipe } = await getRecipeFor(req.user, toInt(req.params.id));
  const rating = toInt(req.body.rating, 0);
  if (!rating) await knex('recipe_ratings').where({ user_id: req.user.id, recipe_id: recipe.id }).del();
  else {
    if (rating < 1 || rating > 5) throw badRequest('Bewertung 1–5');
    await knex.raw('INSERT INTO recipe_ratings (user_id, recipe_id, rating) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE rating = VALUES(rating), updated_at = NOW()', [req.user.id, recipe.id, rating]);
  }
  const agg = await knex('recipe_ratings').where({ recipe_id: recipe.id }).avg({ avg: 'rating' }).count({ count: '*' }).first();
  res.json({ my_rating: rating || null, avg_rating: agg.avg != null ? Math.round(Number(agg.avg) * 10) / 10 : null, rating_count: Number(agg.count) });
}));

r.put('/recipes/:id/personal', ah(async (req, res) => {
  const { recipe } = await getRecipeFor(req.user, toInt(req.params.id));
  const existing = await knex('recipe_personal').where({ user_id: req.user.id, recipe_id: recipe.id }).first();
  const data = {
    note: 'note' in req.body ? String(req.body.note || '').slice(0, 10000) : existing?.note || null,
    variant: 'variant' in req.body ? json(req.body.variant ? {
      servings: Number(req.body.variant.servings) || null,
      ingredients: Array.isArray(req.body.variant.ingredients) ? req.body.variant.ingredients : null,
      steps: Array.isArray(req.body.variant.steps) ? req.body.variant.steps : null,
      notes: req.body.variant.notes ? String(req.body.variant.notes).slice(0, 5000) : '',
      updated_at: new Date().toISOString(),
    } : null) : existing?.variant ?? null,
    offline: 'offline' in req.body ? !!req.body.offline : !!existing?.offline,
  };
  if (existing) await knex('recipe_personal').where({ user_id: req.user.id, recipe_id: recipe.id }).update({ ...data, updated_at: knex.fn.now() });
  else await knex('recipe_personal').insert({ user_id: req.user.id, recipe_id: recipe.id, ...data });
  res.json({ note: data.note || '', variant: parseJson(data.variant, null), offline: data.offline });
}));

r.get('/offline-recipes', ah(async (req, res) => {
  const rows = await knex('recipe_personal').where({ user_id: req.user.id, offline: true }).select('recipe_id');
  res.json({ ids: rows.map((x) => x.recipe_id) });
}));

// ---------- Versionen ----------

r.get('/recipes/:id/versions', ah(async (req, res) => {
  const { recipe } = await getRecipeFor(req.user, toInt(req.params.id));
  const rows = await knex('recipe_versions as v').leftJoin('users as u', 'u.id', 'v.user_id')
    .where('v.recipe_id', recipe.id).select('v.id', 'v.change_note', 'v.created_at', 'u.display_name').orderBy('v.id', 'desc');
  res.json({ items: rows.map((v) => ({ id: v.id, note: v.change_note, created_at: v.created_at, user: v.display_name })) });
}));

r.get('/recipes/:id/versions/:vid', ah(async (req, res) => {
  const { recipe } = await getRecipeFor(req.user, toInt(req.params.id));
  const v = await knex('recipe_versions').where({ id: toInt(req.params.vid), recipe_id: recipe.id }).first();
  if (!v) throw notFound();
  res.json({ id: v.id, created_at: v.created_at, note: v.change_note, snapshot: parseJson(v.snapshot) });
}));

r.post('/recipes/:id/versions/:vid/restore', ah(async (req, res) => {
  const id = toInt(req.params.id);
  await getRecipeFor(req.user, id, 'edit');
  const v = await knex('recipe_versions').where({ id: toInt(req.params.vid), recipe_id: id }).first();
  if (!v) throw notFound();
  await updateRecipe(req.user, id, parseJson(v.snapshot), `Version vom ${String(v.created_at).slice(0, 16)} wiederhergestellt`);
  res.json({ ok: true });
}));

// ---------- Kochprotokoll ----------

r.post('/recipes/:id/cooked', ah(async (req, res) => {
  const { recipe } = await getRecipeFor(req.user, toInt(req.params.id));
  const cookedAt = req.body.cooked_at ? new Date(req.body.cooked_at) : new Date();
  const [id] = await knex('cook_log').insert({
    recipe_id: recipe.id, user_id: req.user.id, cooked_at: cookedAt.toISOString().slice(0, 19).replace('T', ' '),
    servings: Number(req.body.servings) || null, notes: req.body.notes ? String(req.body.notes).slice(0, 5000) : null,
    rating: toInt(req.body.rating),
  });
  if (toInt(req.body.rating)) {
    await knex.raw('INSERT INTO recipe_ratings (user_id, recipe_id, rating) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE rating = VALUES(rating)', [req.user.id, recipe.id, Math.min(5, Math.max(1, toInt(req.body.rating)))]);
  }
  res.status(201).json({ id });
}));

r.delete('/recipes/:id/cooked/:logId', ah(async (req, res) => {
  await knex('cook_log').where({ id: toInt(req.params.logId), user_id: req.user.id }).del();
  res.json({ ok: true });
}));

// ---------- Teilen & Veröffentlichen ----------

r.get('/recipes/:id/sharing', ah(async (req, res) => {
  const { recipe, perm } = await getRecipeFor(req.user, toInt(req.params.id));
  const shares = await knex('recipe_shares as s')
    .leftJoin('users as u', 'u.id', 's.user_id').leftJoin('groups as g', 'g.id', 's.group_id')
    .where('s.recipe_id', recipe.id).select('s.id', 's.permission', 's.user_id', 's.group_id', 'u.display_name', 'u.email', 'g.name as group_name');
  const links = perm === 'owner' || perm === 'edit'
    ? await knex('share_links').where({ recipe_id: recipe.id }).whereNull('revoked_at').select('id', 'token', 'created_at') : [];
  res.json({
    perm,
    group_id: recipe.group_id,
    is_public: !!recipe.is_public,
    public_slug: recipe.public_slug,
    shares: shares.map((s) => ({ id: s.id, permission: s.permission, user_id: s.user_id, group_id: s.group_id, name: s.group_name || s.display_name, email: s.email })),
    links,
  });
}));

r.put('/recipes/:id/sharing', ah(async (req, res) => {
  const { recipe } = await getRecipeFor(req.user, toInt(req.params.id), 'owner');
  const groupId = toInt(req.body.group_id);
  if (groupId) await assertGroupRole(req.user, groupId, 'editor');
  await knex('recipes').where({ id: recipe.id }).update({ group_id: groupId || null });
  res.json({ ok: true, group_id: groupId || null });
}));

r.post('/recipes/:id/shares', ah(async (req, res) => {
  const { recipe } = await getRecipeFor(req.user, toInt(req.params.id), 'owner');
  const permission = req.body.permission === 'edit' ? 'edit' : 'view';
  let userId = null;
  let groupId = toInt(req.body.group_id);
  if (groupId) {
    const ms = await memberships(req.user.id);
    if (!ms.some((m) => m.group_id === groupId)) throw badRequest('Du bist nicht Mitglied dieser Gruppe');
  } else {
    const who = String(req.body.user || '').trim().toLowerCase();
    const u = await knex('users').whereRaw('LOWER(email) = ?', [who]).orWhereRaw('LOWER(username) = ?', [who]).first();
    if (!u) throw badRequest('Kein Benutzer mit dieser E-Mail-Adresse bzw. diesem Benutzernamen gefunden');
    if (u.id === req.user.id) throw badRequest('Das bist du selbst');
    userId = u.id;
  }
  await knex('recipe_shares').where({ recipe_id: recipe.id, user_id: userId, group_id: groupId || null }).del();
  await knex('recipe_shares').insert({ recipe_id: recipe.id, user_id: userId, group_id: groupId || null, permission });
  res.status(201).json({ ok: true });
}));

r.delete('/recipes/:id/shares/:sid', ah(async (req, res) => {
  const { recipe } = await getRecipeFor(req.user, toInt(req.params.id), 'owner');
  await knex('recipe_shares').where({ id: toInt(req.params.sid), recipe_id: recipe.id }).del();
  res.json({ ok: true });
}));

r.post('/recipes/:id/links', ah(async (req, res) => {
  const { recipe } = await getRecipeFor(req.user, toInt(req.params.id), 'edit');
  const t = token(18);
  await knex('share_links').insert({ recipe_id: recipe.id, token: t, created_by: req.user.id });
  res.status(201).json({ token: t });
}));

r.delete('/recipes/:id/links/:lid', ah(async (req, res) => {
  const { recipe } = await getRecipeFor(req.user, toInt(req.params.id), 'edit');
  await knex('share_links').where({ id: toInt(req.params.lid), recipe_id: recipe.id }).update({ revoked_at: knex.fn.now() });
  res.json({ ok: true });
}));

r.put('/recipes/:id/publish', ah(async (req, res) => {
  const { recipe } = await getRecipeFor(req.user, toInt(req.params.id), 'owner');
  const pub = !!req.body.public;
  const slug = recipe.public_slug || (await uniqueSlug(recipe.title));
  await knex('recipes').where({ id: recipe.id }).update({ is_public: pub, public_slug: slug, published_at: pub ? knex.fn.now() : null });
  res.json({ is_public: pub, public_slug: slug });
}));

// ---------- Export ----------

async function exportRecipes(user, ids, withImages) {
  const out = [];
  for (const id of ids) {
    try {
      const { recipe } = await getRecipeFor(user, id);
      const snap = snapshotOf(recipe);
      delete snap.images;
      if (withImages && recipe.image) {
        try { snap.image_data = (await readFile(path.join(uploadsDir, recipe.image))).toString('base64'); } catch { /* ohne Bild */ }
      }
      out.push(snap);
    } catch { /* übersprungen */ }
  }
  return { format: 'rezeptbuch', version: 1, exported_at: new Date().toISOString(), recipes: out };
}

r.get('/export', ah(async (req, res) => {
  let ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean);
  if (!ids.length) ids = (await baseQuery(req.user).select('r.id')).map((x) => x.id);
  const data = await exportRecipes(req.user, ids, req.query.images !== '0');
  const name = ids.length === 1 && data.recipes[0] ? data.recipes[0].title.replace(/[^\wäöüÄÖÜß -]/g, '').slice(0, 60) : 'rezepte';
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}.rezeptbuch.json"`);
  res.json(data);
}));

// ---------- Rezeptbücher (Hilfsfunktion, auch von cookbooks-Routen genutzt) ----------

export async function addToCookbook(user, cookbookId, recipeId) {
  const cb = await knex('cookbooks').where({ id: cookbookId }).first();
  if (!cb) throw notFound('Rezeptbuch nicht gefunden');
  if (cb.group_id) await assertGroupRole(user, cb.group_id, 'editor');
  else if (cb.owner_id !== user.id) throw notFound('Rezeptbuch nicht gefunden');
  await getRecipeFor(user, recipeId);
  await knex.raw('INSERT IGNORE INTO cookbook_recipes (cookbook_id, recipe_id, added_by) VALUES (?, ?, ?)', [cookbookId, recipeId, user.id]);
}

// Kompatibilität: snapshot speichern bei Massenänderungen
export { saveVersion };

export default r;
