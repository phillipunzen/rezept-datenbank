const FRAC = [[0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']];
const NO_FRACTION_UNITS = new Set(['g', 'kg', 'mg', 'ml', 'l', 'cl', 'dl']);

export function formatAmount(n, unit = '') {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return '';
  let v = Number(n);
  if (NO_FRACTION_UNITS.has(unit)) {
    if (unit === 'g' || unit === 'ml') {
      if (v >= 100) v = Math.round(v / 5) * 5;
      else v = Math.round(v * 10) / 10;
    } else v = Math.round(v * 100) / 100;
    return String(v).replace('.', ',');
  }
  const whole = Math.floor(v);
  const rest = v - whole;
  if (rest < 0.06) return String(whole || (v > 0 ? '' : 0)) || String(Math.round(v * 100) / 100).replace('.', ',');
  if (rest > 0.94) return String(whole + 1);
  for (const [f, sym] of FRAC) if (Math.abs(rest - f) < 0.04) return whole ? `${whole} ${sym}` : sym;
  return String(Math.round(v * 100) / 100).replace('.', ',');
}

export function formatMinutes(min, t) {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h} ${t ? t('Std.') : 'Std.'} ${m} ${t ? t('Min.') : 'Min.'}`;
  if (h) return `${h} ${t ? t('Std.') : 'Std.'}`;
  return `${m} ${t ? t('Min.') : 'Min.'}`;
}

export function formatSeconds(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export const parseDbDate = (s) => (s ? new Date(String(s).replace(' ', 'T') + (String(s).length <= 10 ? 'T00:00:00' : 'Z')) : null);

export function formatDate(s, lang = 'de', opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const d = s instanceof Date ? s : parseDbDate(s);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'de-DE', opts);
}

export function formatDateTime(s, lang = 'de') {
  const d = parseDbDate(s);
  if (!d) return '';
  return d.toLocaleString(lang === 'en' ? 'en-GB' : 'de-DE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const isoDate = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function tmTemp(temp) {
  if (temp == null || temp === '') return '';
  return /^\d+$/.test(String(temp)) ? `${temp} °C` : temp;
}

export const TM_MODES = {
  kneten: 'Teig kneten', turbo: 'Turbo', anbraten: 'Anbraten', dampfgaren: 'Dampfgaren', sanftruehren: 'Sanftrühren',
  garen: 'Garen', zerkleinern: 'Zerkleinern', emulgieren: 'Emulgieren', schlagen: 'Schlagen', aufwaermen: 'Aufwärmen',
  fermentieren: 'Fermentieren', sousvide: 'Sous-vide', slowcook: 'Slow Cook', reis: 'Reis kochen',
};
