import { knex, parseJson, json } from '../db.js';
import { badRequest, slugify, token } from '../util.js';
import { imageUrl, thumbUrl } from './images.js';
import { normalizeUnit } from './ingredients.js';

const num = (v) => {
  if (v === '' || v == null) return null;
  const f = String(v).trim().match(/^(\d+)\/(\d+)$/);
  if (f) return Number(f[1]) / Number(f[2]);
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const int = (v) => {
  const n = num(v);
  return n == null ? null : Math.max(0, Math.round(n));
};
const str = (v, max = 5000) => (v == null ? '' : String(v).slice(0, max));

export function cleanIngredients(groups) {
  if (!Array.isArray(groups)) return [];
  return groups
    .map((g) => ({
      name: str(g?.name, 120).trim(),
      items: (Array.isArray(g?.items) ? g.items : [])
        .map((i) => ({
          amount: num(i?.amount),
          unit: normalizeUnit(str(i?.unit, 40)),
          name: str(i?.name, 255).trim(),
          note: str(i?.note, 255).trim(),
          ...(i?.uncertain ? { uncertain: true } : {}),
        }))
        .filter((i) => i.name),
    }))
    .filter((g) => g.items.length || g.name);
}

const TM_MODES = ['', 'kneten', 'turbo', 'anbraten', 'dampfgaren', 'sanftruehren', 'garen', 'zerkleinern', 'emulgieren', 'schlagen', 'aufwaermen', 'fermentieren', 'sousvide', 'slowcook', 'reis'];

function cleanTm(tm) {
  if (!tm || typeof tm !== 'object') return null;
  const out = {
    time: int(tm.time),
    temp: tm.temp == null || tm.temp === '' ? null : str(tm.temp, 10),
    speed: tm.speed == null || tm.speed === '' ? null : str(tm.speed, 20),
    reverse: !!tm.reverse,
    mode: TM_MODES.includes(tm.mode) ? tm.mode : '',
  };
  if (!out.time && !out.temp && !out.speed && !out.mode && !out.reverse) return null;
  return out;
}

export function cleanSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps
    .map((s) => (typeof s === 'string' ? { text: s } : s || {}))
    .map((s) => {
      const out = { text: str(s.text, 5000).trim() };
      if (s.title) out.title = str(s.title, 150).trim();
      const timer = int(s.timer);
      if (timer) out.timer = timer;
      const tm = cleanTm(s.tm);
      if (tm) out.tm = tm;
      if (s.image) out.image = str(s.image, 200);
      if (s.uncertain) out.uncertain = true;
      return out;
    })
    .filter((s) => s.text || s.title);
}

function cleanNutrition(n) {
  if (!n || typeof n !== 'object') return null;
  const out = {};
  for (const k of ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'salt']) {
    const v = num(n[k]);
    if (v != null) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

function cleanTags(tags) {
  if (typeof tags === 'string') tags = tags.split(',');
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((t) => str(t, 50).trim()).filter(Boolean))].slice(0, 30);
}

/** Validiert Eingaben aus Formular/Import und erzeugt DB-Felder. */
export function recipeFields(input) {
  const title = str(input.title, 255).trim();
  if (!title) throw badRequest('Bitte gib einen Titel ein');
  const ingredients = cleanIngredients(input.ingredients);
  const steps = cleanSteps(input.steps);
  const tags = cleanTags(input.tags);
  const images = (Array.isArray(input.images) ? input.images : []).filter((i) => typeof i === 'string' && /^recipes\/[\w-]+\.webp$/.test(i));
  const fields = {
    title,
    description: str(input.description, 5000),
    servings: num(input.servings) || 4,
    servings_unit: str(input.servings_unit, 50),
    prep_time: int(input.prep_time),
    cook_time: int(input.cook_time),
    rest_time: int(input.rest_time),
    difficulty: ['easy', 'medium', 'hard'].includes(input.difficulty) ? input.difficulty : null,
    category: str(input.category, 100).trim() || null,
    tags: json(tags),
    ingredients: json(ingredients),
    steps: json(steps),
    nutrition: json(cleanNutrition(input.nutrition)),
    notes: str(input.notes, 10000),
    source_url: str(input.source_url, 1000) || null,
    source_note: str(input.source_note, 2000) || null,
    images: json(images),
    image: images[0] || null,
    thermomix: !!input.thermomix || steps.some((s) => s.tm),
    tm_model: input.tm_model ? str(input.tm_model, 20) : null,
  };
  fields.search_text = [
    title, fields.description, fields.category, tags.join(' '),
    ingredients.flatMap((g) => g.items.map((i) => i.name)).join(' '),
  ].join(' ').toLowerCase().slice(0, 60000);
  return fields;
}

export function snapshotOf(r) {
  const keys = ['title', 'description', 'servings', 'servings_unit', 'prep_time', 'cook_time', 'rest_time', 'difficulty', 'category', 'tags', 'ingredients', 'steps', 'nutrition', 'notes', 'source_url', 'source_note', 'images', 'thermomix', 'tm_model'];
  const s = {};
  for (const k of keys) s[k] = ['tags', 'ingredients', 'steps', 'nutrition', 'images'].includes(k) ? parseJson(r[k]) : r[k];
  return s;
}

export async function saveVersion(trx, recipeId, userId, note) {
  const r = await trx('recipes').where({ id: recipeId }).first();
  await trx('recipe_versions').insert({ recipe_id: recipeId, user_id: userId, change_note: note?.slice(0, 255) || null, snapshot: json(snapshotOf(r)) });
  // Höchstens 50 Versionen pro Rezept aufbewahren
  const old = await trx('recipe_versions').where({ recipe_id: recipeId }).orderBy('id', 'desc').offset(50).select('id');
  if (old.length) await trx('recipe_versions').whereIn('id', old.map((o) => o.id)).del();
}

export async function createRecipe(user, input, { groupId = null, changeNote = 'Erstellt' } = {}) {
  const fields = recipeFields(input);
  return knex.transaction(async (trx) => {
    const [id] = await trx('recipes').insert({ ...fields, owner_id: user.id, group_id: groupId, updated_by: user.id });
    await saveVersion(trx, id, user.id, changeNote);
    return id;
  });
}

export async function updateRecipe(user, id, input, changeNote = 'Bearbeitet') {
  const fields = recipeFields(input);
  await knex.transaction(async (trx) => {
    await trx('recipes').where({ id }).update({ ...fields, updated_by: user.id, updated_at: knex.fn.now() });
    await saveVersion(trx, id, user.id, changeNote);
  });
}

/** Wandelt eine DB-Zeile in eine API-Antwort um. */
export function serializeRecipe(r, extra = {}) {
  const images = parseJson(r.images, []) || [];
  const total = (r.prep_time || 0) + (r.cook_time || 0) + (r.rest_time || 0);
  return {
    id: r.id,
    title: r.title,
    description: r.description || '',
    servings: r.servings != null ? Number(r.servings) : 4,
    servings_unit: r.servings_unit || '',
    prep_time: r.prep_time,
    cook_time: r.cook_time,
    rest_time: r.rest_time,
    total_time: total || null,
    difficulty: r.difficulty,
    category: r.category,
    tags: parseJson(r.tags, []) || [],
    ingredients: parseJson(r.ingredients, []) || [],
    steps: parseJson(r.steps, []) || [],
    nutrition: parseJson(r.nutrition, null),
    notes: r.notes || '',
    source_url: r.source_url,
    source_note: r.source_note,
    images,
    image: r.image,
    image_url: imageUrl(r.image),
    thumb_url: thumbUrl(r.image),
    image_urls: images.map(imageUrl),
    thermomix: !!r.thermomix,
    tm_model: r.tm_model,
    is_public: !!r.is_public,
    public_slug: r.public_slug,
    owner_id: r.owner_id,
    group_id: r.group_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    deleted_at: r.deleted_at,
    ...extra,
  };
}

/** Kartenansicht – ohne große Felder. */
export function serializeCard(r) {
  const total = (r.prep_time || 0) + (r.cook_time || 0) + (r.rest_time || 0);
  return {
    id: r.id,
    title: r.title,
    description: r.description ? String(r.description).slice(0, 200) : '',
    image_url: imageUrl(r.image),
    thumb_url: thumbUrl(r.image),
    total_time: total || null,
    category: r.category,
    tags: parseJson(r.tags, []) || [],
    thermomix: !!r.thermomix,
    is_public: !!r.is_public,
    group_id: r.group_id,
    owner_id: r.owner_id,
    favorite: r.favorite != null ? !!r.favorite : undefined,
    avg_rating: r.avg_rating != null ? Number(r.avg_rating) : null,
    last_cooked: r.last_cooked || null,
    servings: r.servings != null ? Number(r.servings) : null,
    deleted_at: r.deleted_at || undefined,
  };
}

/** Öffentliche Darstellung: ohne Quelle, Notizen oder interne Angaben. */
export function serializePublic(r, ownerName) {
  const s = serializeRecipe(r);
  delete s.source_url;
  delete s.source_note;
  delete s.notes;
  delete s.owner_id;
  delete s.group_id;
  delete s.deleted_at;
  s.author = ownerName || null;
  return s;
}

export async function uniqueSlug(title) {
  const base = slugify(title);
  return `${base}-${token(4).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
}
