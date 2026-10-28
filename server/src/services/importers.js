// Importe: Rezept-Websites (schema.org), Tandoor (API + Export-Datei), eigene JSON-Dateien.
import * as cheerio from 'cheerio';
import AdmZip from 'adm-zip';
import { safeFetch } from './fetch.js';
import { downloadImage, saveImage } from './images.js';
import { parseIngredientLine } from './ingredients.js';

// ---------- Hilfen ----------

export function parseDuration(v) {
  if (!v) return null;
  if (typeof v === 'number') return Math.round(v);
  const s = String(v).trim();
  const m = s.match(/^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+)S)?)?$/i);
  if (m) {
    const total = (Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0) + Math.round(Number(m[4] || 0) / 60);
    return total || null;
  }
  const n = s.match(/(\d+)\s*(min|minute|minuten|h|std|stunde|stunden|hour|hours)?/i);
  if (n) return /^(h|std|stunde|hour)/i.test(n[2] || '') ? Number(n[1]) * 60 : Number(n[1]);
  return null;
}

const decode = (s) => cheerio.load(`<div>${s ?? ''}</div>`)('div').text().replace(/\s+/g, ' ').trim();

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function pickImage(img) {
  const first = asArray(img)[0];
  if (!first) return null;
  if (typeof first === 'string') return first;
  return first.url || first.contentUrl || null;
}

function parseServings(y) {
  const v = asArray(y).map(String).find((s) => /\d/.test(s)) ?? asArray(y)[0];
  if (v == null) return { servings: 4, unit: '' };
  const m = String(v).match(/(\d+(?:[.,]\d+)?)\s*(.*)/);
  if (!m) return { servings: 4, unit: '' };
  return { servings: Number(m[1].replace(',', '.')) || 4, unit: decode(m[2]).replace(/^(portionen|portion|servings?|personen)$/i, '').slice(0, 50) };
}

function instructionsToSteps(ins) {
  const steps = [];
  const walk = (node, section) => {
    if (!node) return;
    if (typeof node === 'string') {
      const text = decode(node);
      // Ein einzelner langer Text mit Zeilenumbrüchen oder Nummerierung wird aufgeteilt
      const parts = String(node).split(/\n+|<br\s*\/?>|(?=\b\d+\.\s)/i).map(decode).filter((p) => p.length > 2);
      if (parts.length > 1) parts.forEach((p) => steps.push({ text: p.replace(/^\d+\.\s*/, ''), ...(section ? { title: section } : {}) }));
      else if (text) steps.push({ text, ...(section ? { title: section } : {}) });
      return;
    }
    if (Array.isArray(node)) return node.forEach((n) => walk(n, section));
    const type = asArray(node['@type'])[0];
    if (type === 'HowToSection') {
      let first = true;
      const name = decode(node.name);
      const generic = /^(zubereitung|anleitung|instructions?|directions?|method|preparation)$/i.test(name);
      for (const item of asArray(node.itemListElement)) {
        walk(item, first && !generic ? name : undefined);
        first = false;
      }
      return;
    }
    const text = decode(node.text || node.description || node.name || '');
    if (text) steps.push({ text, ...(section ? { title: section } : {}) });
  };
  walk(ins);
  return steps;
}

function nutritionFrom(n) {
  if (!n) return null;
  const g = (v) => {
    const m = String(v ?? '').replace(',', '.').match(/[\d.]+/);
    return m ? Number(m[0]) : null;
  };
  const out = {
    calories: g(n.calories), protein: g(n.proteinContent), carbs: g(n.carbohydrateContent),
    fat: g(n.fatContent), fiber: g(n.fiberContent), sugar: g(n.sugarContent),
  };
  Object.keys(out).forEach((k) => out[k] == null && delete out[k]);
  return Object.keys(out).length ? out : null;
}

function indexIds(data, map = new Map()) {
  if (Array.isArray(data)) data.forEach((d) => indexIds(d, map));
  else if (data && typeof data === 'object') {
    if (data['@id'] && Object.keys(data).length > 1) map.set(data['@id'], data);
    for (const v of Object.values(data)) if (v && typeof v === 'object') indexIds(v, map);
  }
  return map;
}

function findRecipeNode(data) {
  const ids = indexIds(data);
  const node = findRecipeNodeRaw(data);
  if (node && node.image) {
    node.image = asArray(node.image).map((img) => (img && typeof img === 'object' && img['@id'] && ids.has(img['@id']) ? ids.get(img['@id']) : img));
  }
  return node;
}

function findRecipeNodeRaw(data) {
  const stack = asArray(data);
  while (stack.length) {
    const n = stack.shift();
    if (!n || typeof n !== 'object') continue;
    const types = asArray(n['@type']).map(String);
    if (types.includes('Recipe')) return n;
    if (n['@graph']) stack.push(...asArray(n['@graph']));
    if (n.mainEntity) stack.push(...asArray(n.mainEntity));
    if (Array.isArray(n)) stack.push(...n);
  }
  return null;
}

/** Wandelt ein schema.org-Recipe-Objekt in einen Rezeptentwurf um. */
export function fromSchemaOrg(node, sourceUrl) {
  const { servings, unit } = parseServings(node.recipeYield);
  const ingredientLines = asArray(node.recipeIngredient || node.ingredients).map(decode).filter(Boolean);
  const keywords = typeof node.keywords === 'string' ? node.keywords.split(',') : asArray(node.keywords);
  const prep = parseDuration(node.prepTime);
  const cook = parseDuration(node.cookTime);
  const total = parseDuration(node.totalTime);
  return {
    title: decode(node.name) || 'Importiertes Rezept',
    description: decode(node.description),
    servings,
    servings_unit: unit,
    prep_time: prep,
    cook_time: cook ?? (total && prep ? Math.max(0, total - prep) : total),
    category: decode(asArray(node.recipeCategory)[0] || '').split(',')[0].trim() || null,
    tags: [...new Set([...keywords.map(decode), ...asArray(node.recipeCuisine).map(decode)].filter(Boolean))].slice(0, 15),
    ingredients: [{ name: '', items: ingredientLines.map(parseIngredientLine).filter(Boolean) }],
    steps: instructionsToSteps(node.recipeInstructions),
    nutrition: nutritionFrom(node.nutrition),
    source_url: sourceUrl || node.url || null,
    _remote_image: pickImage(node.image),
  };
}

// ---------- Website ----------

export async function importFromUrl(url) {
  const res = await safeFetch(url, { timeout: 20000, maxBytes: 8 * 1024 * 1024, headers: { Accept: 'text/html,application/xhtml+xml' } });
  const html = res.text();
  const $ = cheerio.load(html);
  let node = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (node) return;
    const raw = $(el).contents().text().trim();
    try {
      node = findRecipeNode(JSON.parse(raw));
    } catch {
      try { node = findRecipeNode(JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' '))); } catch { /* weiter */ }
    }
  });
  if (!node) node = microdataRecipe($);
  const pageText = () => {
    $('script,style,nav,footer,header,noscript,iframe').remove();
    return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 40000);
  };
  if (!node) {
    return { found: false, title: decode($('title').text()), page_text: pageText(), image: $('meta[property="og:image"]').attr('content') || null };
  }
  const draft = fromSchemaOrg(node, res.url || url);
  if (!draft._remote_image) draft._remote_image = $('meta[property="og:image"]').attr('content') || null;
  const warnings = [];
  if (!draft.ingredients[0].items.length) warnings.push('Keine Zutaten gefunden');
  if (!draft.steps.length) warnings.push('Keine Zubereitungsschritte gefunden');
  return { found: true, draft, warnings };
}

function microdataRecipe($) {
  const scope = $('[itemtype*="schema.org/Recipe"]').first();
  if (!scope.length) return null;
  const prop = (p) => scope.find(`[itemprop="${p}"]`);
  const val = (el) => $(el).attr('content') || $(el).attr('datetime') || $(el).text();
  return {
    '@type': 'Recipe',
    name: val(prop('name').first()),
    description: val(prop('description').first()),
    recipeYield: val(prop('recipeYield').first()),
    prepTime: val(prop('prepTime').first()),
    cookTime: val(prop('cookTime').first()),
    totalTime: val(prop('totalTime').first()),
    recipeIngredient: prop('recipeIngredient').add(prop('ingredients')).map((_, e) => val(e)).get(),
    recipeInstructions: prop('recipeInstructions').map((_, e) => $(e).text()).get(),
    image: prop('image').first().attr('src') || prop('image').first().attr('content'),
  };
}

export async function attachRemoteImage(draft) {
  if (draft._remote_image) {
    const rel = await downloadImage(draft._remote_image);
    if (rel) draft.images = [rel, ...(draft.images || [])];
  }
  delete draft._remote_image;
  return draft;
}

// ---------- Tandoor ----------

function tandoorToDraft(r, baseUrl) {
  const groups = [];
  const steps = [];
  for (const st of r.steps || []) {
    let current = { name: st.name || '', items: [] };
    for (const ing of st.ingredients || []) {
      if (ing.is_header) {
        if (current.items.length || current.name) groups.push(current);
        current = { name: ing.note || ing.food?.name || '', items: [] };
        continue;
      }
      const name = ing.food?.plural_name && ing.amount > 1 ? ing.food.plural_name : ing.food?.name;
      if (!name) continue;
      current.items.push({
        amount: ing.no_amount ? null : (ing.amount || null),
        unit: ing.unit?.name || '',
        name,
        note: ing.note || '',
      });
    }
    if (current.items.length) groups.push(current);
    const text = String(st.instruction || st.instructions_markdown || '').replace(/\r/g, '').trim();
    if (text || st.name) {
      steps.push({ title: st.name || undefined, text: text || st.name, ...(st.time ? { timer: st.time * 60 } : {}) });
    }
  }
  // Gruppen mit gleichem Namen zusammenführen
  const merged = [];
  for (const g of groups) {
    const ex = merged.find((m) => m.name === g.name);
    if (ex) ex.items.push(...g.items); else merged.push(g);
  }
  const n = r.nutrition;
  return {
    title: r.name,
    description: r.description || '',
    servings: r.servings || 4,
    servings_unit: r.servings_text || '',
    prep_time: r.working_time || null,
    cook_time: r.waiting_time || null,
    tags: (r.keywords || []).map((k) => k.label || k.name).filter(Boolean),
    ingredients: merged,
    steps,
    nutrition: n ? { calories: Number(n.calories) || undefined, protein: Number(n.proteins) || undefined, carbs: Number(n.carbohydrates) || undefined, fat: Number(n.fats) || undefined } : null,
    source_url: r.source_url || null,
    source_note: `Importiert aus Tandoor (${baseUrl}, ID ${r.id})`,
    _remote_image: r.image ? new URL(r.image, baseUrl).toString() : null,
    _tandoor_id: r.id,
  };
}

export async function tandoorRequest(baseUrl, apiToken, path) {
  const url = new URL(path, baseUrl.replace(/\/?$/, '/')).toString();
  const res = await safeFetch(url, {
    allowPrivate: true,
    timeout: 30000,
    maxBytes: 20 * 1024 * 1024,
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
  });
  return res.json();
}

export async function tandoorList(baseUrl, apiToken) {
  const out = [];
  let next = 'api/recipe/?page_size=100&page=1';
  let guard = 0;
  while (next && guard++ < 200) {
    const data = await tandoorRequest(baseUrl, apiToken, next);
    for (const r of data.results || []) {
      out.push({ id: r.id, name: r.name, image: r.image ? new URL(r.image, baseUrl).toString() : null, description: r.description || '' });
    }
    next = data.next ? data.next : null;
  }
  return out;
}

export async function tandoorRecipe(baseUrl, apiToken, id) {
  const r = await tandoorRequest(baseUrl, apiToken, `api/recipe/${id}/`);
  return tandoorToDraft(r, baseUrl);
}

// ---------- Dateien ----------

/**
 * Liest eine hochgeladene Datei und liefert Rezeptentwürfe.
 * Unterstützt: eigenes Rezeptbuch-JSON, schema.org-JSON(-LD), Tandoor-Export (ZIP), ZIP mit obigen Dateien.
 */
export async function parseImportFile(buffer, filename) {
  const drafts = [];
  const errors = [];
  const handleJson = async (text, name, imageLookup) => {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      errors.push(`${name}: ungültiges JSON`);
      return;
    }
    if (data?.format === 'rezeptbuch' && Array.isArray(data.recipes)) {
      for (const r of data.recipes) {
        const d = { ...r };
        delete d.id;
        if (r.image_data) {
          try { d.images = [await saveImage(Buffer.from(r.image_data, 'base64'))]; } catch { /* ohne Bild */ }
        } else d.images = [];
        delete d.image_data;
        drafts.push(d);
      }
      return;
    }
    // Tandoor-Export: recipe.json mit steps/ingredients/food
    if (data && Array.isArray(data.steps) && data.steps.some((s) => Array.isArray(s.ingredients))) {
      const d = tandoorToDraft({ ...data, id: data.id || '?' }, 'https://tandoor.local/');
      d.source_note = 'Importiert aus Tandoor-Export';
      delete d._remote_image;
      if (imageLookup) {
        const img = imageLookup();
        if (img) { try { d.images = [await saveImage(img)]; } catch { /* ohne Bild */ } }
      }
      drafts.push(d);
      return;
    }
    const node = findRecipeNode(data);
    if (node) {
      const d = fromSchemaOrg(node);
      drafts.push(d);
      return;
    }
    errors.push(`${name}: kein unterstütztes Rezeptformat`);
  };

  if (/\.zip$/i.test(filename) || buffer.slice(0, 2).toString() === 'PK') {
    const walkZip = async (buf, prefix) => {
      const zip = new AdmZip(buf);
      const entries = zip.getEntries();
      for (const e of entries) {
        if (e.isDirectory) continue;
        const name = prefix + e.entryName;
        if (/\.zip$/i.test(e.entryName)) {
          await walkZip(e.getData(), name + '/');
        } else if (/\.json$/i.test(e.entryName)) {
          const dir = e.entryName.includes('/') ? e.entryName.slice(0, e.entryName.lastIndexOf('/') + 1) : '';
          const imageLookup = () => {
            const img = entries.find((x) => !x.isDirectory && x.entryName.startsWith(dir) && /\.(jpe?g|png|webp)$/i.test(x.entryName));
            return img ? img.getData() : null;
          };
          await handleJson(e.getData().toString('utf8'), name, imageLookup);
        }
      }
    };
    try {
      await walkZip(buffer, '');
    } catch (err) {
      errors.push(`ZIP konnte nicht gelesen werden: ${err.message}`);
    }
  } else {
    await handleJson(buffer.toString('utf8'), filename);
  }
  return { drafts, errors };
}
