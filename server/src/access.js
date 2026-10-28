// Zentrale Berechtigungslogik für Rezepte und gruppenbezogene Inhalte.
import { knex } from './db.js';
import { forbidden, notFound } from './util.js';

const RANK = { viewer: 1, editor: 2, owner: 3 };

export async function memberships(userId) {
  return knex('group_members').where({ user_id: userId }).select('group_id', 'role');
}

export async function groupRole(userId, groupId) {
  if (!groupId) return null;
  const m = await knex('group_members').where({ user_id: userId, group_id: groupId }).first();
  return m?.role || null;
}

/**
 * Sichtbare Rezepte für einen Benutzer als knex-where-Callback.
 * Sichtbar: eigene, Rezepte einer Gruppe, direkt geteilte, oder in einem Gruppen-Rezeptbuch.
 */
export function visibleRecipes(userId) {
  return function () {
    const myGroups = knex('group_members').where('user_id', userId).select('group_id');
    this.where('r.owner_id', userId)
      .orWhereIn('r.group_id', myGroups)
      .orWhereIn(
        'r.id',
        knex('recipe_shares').where('user_id', userId).orWhereIn('group_id', myGroups).select('recipe_id'),
      )
      .orWhereIn(
        'r.id',
        knex('cookbook_recipes as cr')
          .join('cookbooks as c', 'c.id', 'cr.cookbook_id')
          .whereIn('c.group_id', knex('group_members').where('user_id', userId).select('group_id'))
          .select('cr.recipe_id'),
      );
  };
}

/** Liefert 'owner' | 'edit' | 'view' | null */
export async function recipePermission(user, recipe) {
  if (!recipe) return null;
  if (recipe.owner_id === user.id) return 'owner';
  const ms = await memberships(user.id);
  const roles = new Map(ms.map((m) => [m.group_id, m.role]));
  let perm = null;
  if (recipe.group_id && roles.has(recipe.group_id)) {
    perm = RANK[roles.get(recipe.group_id)] >= RANK.editor ? 'edit' : 'view';
  }
  if (perm === 'edit') return perm;
  const shares = await knex('recipe_shares').where('recipe_id', recipe.id);
  for (const s of shares) {
    if (s.user_id === user.id || (s.group_id && roles.has(s.group_id))) {
      const groupCanEdit = !s.group_id || RANK[roles.get(s.group_id)] >= RANK.editor;
      if (s.permission === 'edit' && groupCanEdit) return 'edit';
      perm = perm || 'view';
    }
  }
  if (perm) return perm;
  const viaBook = await knex('cookbook_recipes as cr')
    .join('cookbooks as c', 'c.id', 'cr.cookbook_id')
    .where('cr.recipe_id', recipe.id)
    .whereIn('c.group_id', [...roles.keys()].length ? [...roles.keys()] : [0])
    .first();
  return viaBook ? 'view' : null;
}

export async function getRecipeFor(user, id, need = 'view') {
  const recipe = await knex('recipes').where({ id }).first();
  if (!recipe) throw notFound('Rezept nicht gefunden');
  const perm = await recipePermission(user, recipe);
  if (!perm) throw notFound('Rezept nicht gefunden');
  if (recipe.deleted_at && need !== 'owner' && perm !== 'owner') throw notFound('Rezept nicht gefunden');
  if (need === 'edit' && perm === 'view') throw forbidden('Du darfst dieses Rezept nur ansehen');
  if (need === 'owner' && perm !== 'owner') throw forbidden('Nur der Eigentümer darf das');
  return { recipe, perm };
}

/**
 * Bereichs-Berechtigung (Wochenplan, Einkaufsliste, Vorrat, Rezeptbuch):
 * persönlich (group_id null, owner) oder Gruppe.
 */
export async function scopePermission(user, row) {
  if (!row) return null;
  if (!row.group_id) return row.owner_id === user.id ? 'edit' : null;
  const role = await groupRole(user.id, row.group_id);
  if (!role) return row.owner_id === user.id ? 'edit' : null;
  return RANK[role] >= RANK.editor ? 'edit' : 'view';
}

export async function assertScope(user, row, need = 'view') {
  const p = await scopePermission(user, row);
  if (!p) throw notFound();
  if (need === 'edit' && p !== 'edit') throw forbidden('Nur Lesezugriff');
  return p;
}

/** Prüft, ob der Benutzer in einer Gruppe (mind. Rolle) ist – für das Anlegen in Gruppen. */
export async function assertGroupRole(user, groupId, min = 'editor') {
  if (!groupId) return;
  const role = await groupRole(user.id, groupId);
  if (!role || RANK[role] < RANK[min]) throw forbidden('Keine Berechtigung in dieser Gruppe');
}

/** Filter für Bereichslisten: persönliche + Gruppen des Benutzers. Optional ein bestimmter Bereich. */
export function scopeFilter(userId, scope, alias = '') {
  const p = alias ? `${alias}.` : '';
  return function () {
    if (scope === 'personal') {
      this.whereNull(`${p}group_id`).andWhere(`${p}owner_id`, userId);
    } else if (scope && /^\d+$/.test(String(scope))) {
      this.where(`${p}group_id`, Number(scope)).whereIn(
        `${p}group_id`,
        knex('group_members').where('user_id', userId).select('group_id'),
      );
    } else {
      this.where(function () {
        this.whereNull(`${p}group_id`).andWhere(`${p}owner_id`, userId);
      }).orWhereIn(`${p}group_id`, knex('group_members').where('user_id', userId).select('group_id'));
    }
  };
}
