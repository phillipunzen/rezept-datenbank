// Zutaten parsen, normalisieren, zusammenfassen und Einkaufskategorien zuordnen.

const FRACTIONS = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅕': 0.2, '⅙': 1 / 6 };

// Kanonische Einheiten und ihre Schreibweisen
const UNIT_ALIASES = {
  g: ['g', 'gr', 'gramm', 'gram', 'grams', 'gramm.'],
  kg: ['kg', 'kilo', 'kilogramm', 'kilogram', 'kilograms'],
  mg: ['mg'],
  ml: ['ml', 'milliliter', 'millilitre', 'milliliters'],
  cl: ['cl'],
  dl: ['dl'],
  l: ['l', 'liter', 'litre', 'liters', 'litres', 'ltr'],
  TL: ['tl', 'teelöffel', 'tsp', 'teaspoon', 'teaspoons', 'tsp.'],
  EL: ['el', 'esslöffel', 'tbsp', 'tablespoon', 'tablespoons', 'tbsp.', 'tbs'],
  Tasse: ['tasse', 'tassen', 'cup', 'cups'],
  Prise: ['prise', 'prisen', 'pinch', 'pinches'],
  Msp: ['msp', 'msp.', 'messerspitze', 'messerspitzen'],
  Stück: ['stück', 'stk', 'stk.', 'st.', 'piece', 'pieces', 'pc', 'pcs'],
  Zehe: ['zehe', 'zehen', 'clove', 'cloves'],
  Bund: ['bund', 'bunch', 'bunches'],
  Dose: ['dose', 'dosen', 'can', 'cans', 'tin', 'tins'],
  Pck: ['pck', 'pck.', 'päckchen', 'packung', 'packungen', 'pkg', 'package', 'packet', 'pack'],
  Becher: ['becher'],
  Scheibe: ['scheibe', 'scheiben', 'slice', 'slices'],
  Zweig: ['zweig', 'zweige', 'sprig', 'sprigs'],
  Handvoll: ['handvoll', 'handful'],
  Blatt: ['blatt', 'blätter', 'leaf', 'leaves'],
  Glas: ['glas', 'gläser', 'jar', 'jars'],
  Würfel: ['würfel', 'cube', 'cubes'],
  Tropfen: ['tropfen', 'drop', 'drops'],
  Spritzer: ['spritzer', 'dash', 'splash'],
  Stange: ['stange', 'stangen', 'stalk', 'stalks'],
  Knolle: ['knolle', 'knollen'],
  Kopf: ['kopf', 'köpfe', 'head', 'heads'],
  oz: ['oz', 'ounce', 'ounces'],
  lb: ['lb', 'lbs', 'pound', 'pounds'],
};
const UNIT_LOOKUP = new Map();
for (const [canon, list] of Object.entries(UNIT_ALIASES)) for (const a of list) UNIT_LOOKUP.set(a, canon);

export function normalizeUnit(u) {
  if (!u) return '';
  const k = String(u).trim().toLowerCase();
  return UNIT_LOOKUP.get(k) || String(u).trim();
}

// Umrechnungsfamilien für das Zusammenfassen
const BASE = { g: ['g', 1], kg: ['g', 1000], mg: ['g', 0.001], ml: ['ml', 1], cl: ['ml', 10], dl: ['ml', 100], l: ['ml', 1000] };

function parseNumber(s) {
  s = s.trim();
  if (FRACTIONS[s] != null) return FRACTIONS[s];
  const mixedUni = s.match(/^(\d+)\s*([½⅓⅔¼¾⅛⅕⅙])$/);
  if (mixedUni) return Number(mixedUni[1]) + FRACTIONS[mixedUni[2]];
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const NUM = '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\s*[½⅓⅔¼¾⅛⅕⅙]|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?|[½⅓⅔¼¾⅛⅕⅙])';

/** "200 g Mehl (Type 405), gesiebt" -> { amount: 200, unit: 'g', name: 'Mehl', note: 'Type 405, gesiebt' } */
export function parseIngredientLine(line) {
  let s = String(line || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  s = s.replace(/^[-•*·]\s*/, '');
  // Plural-Schreibweisen wie „Zwiebel(n)“ oder „Ei(er)“
  s = s.replace(/([A-Za-zÄÖÜäöüß])\((n|en|e|s|er|nen|chen)\)/g, '$1');
  let amount = null;
  let amountMax = null;
  const m = s.match(new RegExp(`^(${NUM})(?:\\s*(?:-|–|bis|to)\\s*(${NUM}))?\\s*`, 'i'));
  if (m) {
    amount = parseNumber(m[1]);
    if (m[2]) amountMax = parseNumber(m[2]);
    s = s.slice(m[0].length);
  }
  let unit = '';
  const um = s.match(/^([A-Za-zÄÖÜäöüß]+\.?)(?=\s|$)/);
  if (um && UNIT_LOOKUP.has(um[1].toLowerCase())) {
    unit = UNIT_LOOKUP.get(um[1].toLowerCase());
    s = s.slice(um[0].length).trim();
  } else {
    const glued = s.match(/^(g|kg|ml|l|el|tl)\b\.?\s*/i);
    if (glued && amount != null) {
      unit = normalizeUnit(glued[1]);
      s = s.slice(glued[0].length);
    }
  }
  s = s.replace(/^(of|von)\s+/i, '');
  let note = '';
  const paren = s.match(/\(([^)]*)\)/);
  if (paren) {
    note = paren[1].trim();
    s = s.replace(paren[0], ' ').replace(/\s+/g, ' ').trim();
  }
  const comma = s.indexOf(',');
  if (comma > 0) {
    note = [note, s.slice(comma + 1).trim()].filter(Boolean).join(', ');
    s = s.slice(0, comma).trim();
  }
  if (amountMax && amount != null) note = [`${formatAmount(amount)}–${formatAmount(amountMax)}`, note].filter(Boolean).join(', ');
  return { amount, unit, name: s.trim() || String(line).trim(), note };
}

export function formatAmount(n) {
  if (n == null || n === '') return '';
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  if (Math.abs(v - Math.round(v)) < 0.01) return String(Math.round(v));
  return String(Math.round(v * 100) / 100).replace('.', ',');
}

export function ingredientKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-zäöüß0-9 ]/g, ' ')
    .replace(/\b(frische?n?|frisch|gehackte?n?|geriebene?n?|große?n?|kleine?n?|fresh|chopped|large|small|optional|etwas|some)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(en|n|e|s)$/, '');
}

/** Fasst gleichartige Zutaten zusammen; konvertiert g/kg und ml/l. */
export function mergeItems(items) {
  const out = [];
  const index = new Map();
  for (const it of items) {
    const unit = normalizeUnit(it.unit);
    const base = BASE[unit];
    const famUnit = base ? base[0] : unit;
    const key = `${ingredientKey(it.name)}|${famUnit.toLowerCase()}`;
    const amount = it.amount == null || it.amount === '' ? null : Number(it.amount) * (base ? base[1] : 1);
    if (index.has(key)) {
      const e = index.get(key);
      if (amount != null) e.amount = (e.amount || 0) + amount;
      e.sources = [...(e.sources || []), ...(it.sources || [])];
      if (it.note && !String(e.note || '').includes(it.note)) e.note = [e.note, it.note].filter(Boolean).join('; ');
    } else {
      const e = { ...it, unit: famUnit, amount, sources: it.sources || [] };
      index.set(key, e);
      out.push(e);
    }
  }
  // Große Mengen wieder in kg / l darstellen
  for (const e of out) {
    if (e.unit === 'g' && e.amount >= 1000) { e.amount = e.amount / 1000; e.unit = 'kg'; }
    if (e.unit === 'ml' && e.amount >= 1000) { e.amount = e.amount / 1000; e.unit = 'l'; }
    if (e.amount != null) e.amount = Math.round(e.amount * 1000) / 1000;
  }
  return out;
}

const AISLES = [
  ['produce', /(apfel|äpfel|banane|zitrone|limette|orange|beere|tomate|gurke|salat|paprika|zwiebel|knoblauch|karotte|möhre|kartoffel|zucchini|aubergine|spinat|kohl|brokkoli|lauch|porree|sellerie|pilz|champignon|ingwer|petersilie|basilikum|schnittlauch|koriander|minze|dill|rosmarin|thymian|avocado|kürbis|rucola|frühlingszwiebel|schalotte|obst|gemüse|apple|banana|lemon|lime|berry|tomato|cucumber|lettuce|pepper|onion|garlic|carrot|potato|zucchini|spinach|cabbage|broccoli|leek|celery|mushroom|ginger|parsley|basil|chive|cilantro|herb)/],
  ['dairy', /(milch|sahne|butter|käse|quark|joghurt|jogurt|schmand|creme fraiche|crème fraîche|mascarpone|mozzarella|parmesan|feta|ricotta|ei\b|eier|frischkäse|milk|cream|cheese|yogurt|yoghurt|egg)/],
  ['meat', /(fleisch|hähnchen|huhn|pute|rind|schwein|hack|speck|schinken|wurst|lachs|thunfisch|fisch|garnele|shrimp|chicken|beef|pork|bacon|ham|sausage|salmon|tuna|fish|turkey)/],
  ['bakery', /(brot|brötchen|toast|baguette|tortilla|wrap|bread|bun|roll)/],
  ['baking', /(mehl|zucker|backpulver|hefe|vanille|kakao|schokolade|speisestärke|stärke|natron|puderzucker|flour|sugar|baking|yeast|cocoa|chocolate|starch)/],
  ['dry', /(nudel|pasta|spaghetti|reis|linsen|bohnen|kichererbsen|haferflocken|couscous|bulgur|quinoa|nüsse|mandel|walnuss|haselnuss|rice|lentil|bean|chickpea|oat|nut|almond)/],
  ['spices', /(salz|pfeffer|paprikapulver|curry|zimt|muskat|oregano|kreuzkümmel|kümmel|chili|gewürz|lorbeer|brühe|bouillon|salt|spice|cinnamon|nutmeg|cumin|stock)/],
  ['canned', /(dose|passierte|tomatenmark|kokosmilch|öl|essig|senf|ketchup|mayonnaise|sojasauce|honig|marmelade|oil|vinegar|mustard|soy|honey|jam)/],
  ['frozen', /(tiefkühl|tk-|tk |gefroren|frozen|eis\b)/],
  ['drinks', /(wasser|saft|wein|bier|kaffee|tee\b|water|juice|wine|beer|coffee|tea\b)/],
];

export function aisleFor(name) {
  const n = String(name || '').toLowerCase();
  for (const [cat, re] of AISLES) if (re.test(n)) return cat;
  return 'other';
}

/** Alle Zutaten (flach) eines Rezepts mit Faktor skaliert. */
export function flattenIngredients(groups, factor = 1) {
  const out = [];
  for (const g of groups || []) {
    for (const i of g.items || []) {
      if (!i.name) continue;
      out.push({
        name: i.name,
        unit: i.unit || '',
        amount: i.amount == null || i.amount === '' ? null : Number(i.amount) * factor,
        note: i.note || '',
      });
    }
  }
  return out;
}
