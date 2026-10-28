// Einfache Zutatenzeilen-Erkennung im Browser (für „Zutaten als Text einfügen“).
const FR = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125 };
const UNITS = ['g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l', 'el', 'tl', 'esslöffel', 'teelöffel', 'tasse', 'tassen', 'prise', 'prisen', 'msp', 'stück', 'stk', 'zehe', 'zehen', 'bund', 'dose', 'dosen', 'pck', 'päckchen', 'packung', 'becher', 'scheibe', 'scheiben', 'zweig', 'zweige', 'handvoll', 'blatt', 'glas', 'würfel', 'tropfen', 'spritzer', 'cup', 'cups', 'tbsp', 'tsp', 'oz', 'lb'];
const CANON = { el: 'EL', tl: 'TL', esslöffel: 'EL', teelöffel: 'TL', tbsp: 'EL', tsp: 'TL', stk: 'Stück', tassen: 'Tasse', prisen: 'Prise', zehen: 'Zehe', dosen: 'Dose', päckchen: 'Pck', packung: 'Pck', scheiben: 'Scheibe', zweige: 'Zweig', cups: 'Tasse', cup: 'Tasse' };

function num(s) {
  s = s.trim();
  if (FR[s] != null) return FR[s];
  let m = s.match(/^(\d+)\s*([½⅓⅔¼¾⅛])$/);
  if (m) return Number(m[1]) + FR[m[2]];
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function parseLine(line) {
  let s = String(line).replace(/\s+/g, ' ').trim().replace(/^[-•*·]\s*/, '');
  if (!s) return null;
  s = s.replace(/([A-Za-zÄÖÜäöüß])\((n|en|e|s|er)\)/g, '$1');
  let amount = '';
  const m = s.match(/^(\d+\s*[½⅓⅔¼¾⅛]|\d+\/\d+|\d+(?:[.,]\d+)?|[½⅓⅔¼¾⅛])(?:\s*[-–]\s*\S+)?\s*/);
  if (m) { amount = num(m[1]); s = s.slice(m[0].length); }
  let unit = '';
  const um = s.match(/^([A-Za-zÄÖÜäöüß]+)\.?(?=\s|$)/);
  if (um && UNITS.includes(um[1].toLowerCase())) {
    const low = um[1].toLowerCase();
    unit = CANON[low] || (low.length <= 2 ? low : um[1][0].toUpperCase() + um[1].slice(1).toLowerCase());
    if (['g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l'].includes(low)) unit = low;
    s = s.slice(um[0].length).trim();
  }
  let note = '';
  const c = s.indexOf(',');
  if (c > 0) { note = s.slice(c + 1).trim(); s = s.slice(0, c).trim(); }
  return { amount: amount ?? '', unit, name: s, note };
}

export function parseIngredientText(text) {
  const groups = [];
  let cur = { name: '', items: [] };
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/:$/.test(line) && !/^\d/.test(line)) {
      if (cur.items.length || cur.name) groups.push(cur);
      cur = { name: line.replace(/:$/, '').replace(/^für (den|die|das)\s+/i, ''), items: [] };
      continue;
    }
    const p = parseLine(line);
    if (p) cur.items.push(p);
  }
  if (cur.items.length || cur.name) groups.push(cur);
  return groups;
}
