// Öffentlicher Bereich (ohne Anmeldung): veröffentlichte Rezepte und geteilte Links.
import express from 'express';
import { knex } from '../db.js';
import { ah, notFound, toInt } from '../util.js';
import { serializePublic, serializeCard } from '../services/recipes.js';

const r = express.Router();

r.get('/recipes', ah(async (req, res) => {
  const limit = Math.min(toInt(req.query.limit, 36), 100);
  const page = Math.max(toInt(req.query.page, 1), 1);
  let q = knex('recipes as r').where('r.is_public', true).whereNull('r.deleted_at');
  if (req.query.q) for (const w of String(req.query.q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) q = q.where('r.search_text', 'like', `%${w}%`);
  if (req.query.category) q = q.where('r.category', req.query.category);
  const [{ total }] = await q.clone().count({ total: '*' });
  const rows = await q.select('r.*').orderBy('r.published_at', 'desc').limit(limit).offset((page - 1) * limit);
  const cats = await knex('recipes').where('is_public', true).whereNull('deleted_at').whereNotNull('category')
    .groupBy('category').select('category').count({ c: '*' }).orderBy('c', 'desc').limit(20);
  res.json({
    total: Number(total), page, limit,
    items: rows.map((x) => { const c = serializeCard(x); c.slug = x.public_slug; delete c.owner_id; delete c.group_id; return c; }),
    categories: cats.map((c) => c.category),
  });
}));

r.get('/recipes/:slug', ah(async (req, res) => {
  const row = await knex('recipes').where({ public_slug: req.params.slug, is_public: true }).whereNull('deleted_at').first();
  if (!row) throw notFound('Dieses Rezept ist nicht (mehr) öffentlich');
  const owner = await knex('users').where({ id: row.owner_id }).select('display_name').first();
  res.json(serializePublic(row, owner?.display_name));
}));

r.get('/shared/:token', ah(async (req, res) => {
  const link = await knex('share_links').where({ token: req.params.token }).whereNull('revoked_at').first();
  if (!link) throw notFound('Dieser Link ist ungültig oder wurde widerrufen');
  const row = await knex('recipes').where({ id: link.recipe_id }).whereNull('deleted_at').first();
  if (!row) throw notFound('Rezept nicht mehr verfügbar');
  const owner = await knex('users').where({ id: row.owner_id }).select('display_name').first();
  res.json(serializePublic(row, owner?.display_name));
}));

export default r;
