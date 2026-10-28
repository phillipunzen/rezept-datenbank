// Zentrale Claude-Verbindung: Der Administrator hinterlegt einmal einen API-Schlüssel,
// alle freigeschalteten Benutzer nutzen ihn, ohne ihn zu sehen.
// Es gibt keine automatischen Wiederholungen oder Hintergrundanfragen – jede Anfrage
// wird ausschließlich durch eine ausdrückliche Benutzeraktion ausgelöst und gezählt.
import Anthropic from '@anthropic-ai/sdk';
import { knex } from '../db.js';
import { getSettings } from '../settings.js';
import { decrypt, HttpError } from '../util.js';
import { readImageForAi } from './images.js';
import { parseIngredientLine } from './ingredients.js';

export const AI_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

function client(apiKey) {
  return new Anthropic({ apiKey, maxRetries: 0, timeout: 180000 });
}

async function usageCounts(userId) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const [{ month }] = await knex('ai_usage').where('created_at', '>=', monthStart).whereNot('status', 'blocked').count({ month: '*' });
  const [{ day }] = userId
    ? await knex('ai_usage').where('created_at', '>=', dayStart).andWhere('user_id', userId).whereNot('status', 'blocked').count({ day: '*' })
    : [{ day: 0 }];
  const [{ tokens_in, tokens_out }] = await knex('ai_usage').where('created_at', '>=', monthStart)
    .sum({ tokens_in: 'input_tokens', tokens_out: 'output_tokens' });
  return { month: Number(month), day: Number(day), tokens_in: Number(tokens_in || 0), tokens_out: Number(tokens_out || 0) };
}

export async function aiStatus(user) {
  const s = await getSettings();
  const ai = s.ai;
  const configured = !!ai.api_key_enc;
  const counts = await usageCounts(user?.id);
  let available = configured && ai.enabled && (ai.shared || user?.role === 'admin');
  let reason = null;
  if (!configured) reason = 'not_configured';
  else if (!ai.enabled) reason = 'disabled';
  else if (!ai.shared && user?.role !== 'admin') reason = 'not_shared';
  else if (ai.monthly_limit && counts.month >= ai.monthly_limit) { available = false; reason = 'monthly_limit'; }
  else if (ai.per_user_daily_limit && counts.day >= ai.per_user_daily_limit) { available = false; reason = 'daily_limit'; }
  return {
    available,
    reason,
    configured,
    enabled: !!ai.enabled,
    shared: !!ai.shared,
    model: ai.model,
    monthly_limit: ai.monthly_limit,
    per_user_daily_limit: ai.per_user_daily_limit,
    used_month: counts.month,
    used_today: counts.day,
    ...(user?.role === 'admin' ? { tokens_in_month: counts.tokens_in, tokens_out_month: counts.tokens_out } : {}),
  };
}

const REASON_TEXT = {
  not_configured: 'Die KI-Verbindung wurde vom Administrator noch nicht eingerichtet.',
  disabled: 'Die KI-Funktionen sind derzeit deaktiviert.',
  not_shared: 'Die KI-Verbindung ist nur für Administratoren freigegeben.',
  monthly_limit: 'Das monatliche KI-Kontingent dieser Installation ist aufgebraucht. Es wird zu Monatsbeginn zurückgesetzt.',
  daily_limit: 'Du hast dein tägliches KI-Kontingent erreicht. Morgen geht es weiter.',
};

/** Übersetzt API-Fehler in verständliche Meldungen. */
function friendlyError(err) {
  const status = err?.status;
  const type = err?.error?.error?.type || err?.error?.type;
  const msg = String(err?.error?.error?.message || err?.message || '');
  if (err instanceof Anthropic.AuthenticationError) return new HttpError(502, 'Der hinterlegte Claude-Zugang ist ungültig oder wurde widerrufen. Bitte den Administrator informieren.', 'ai_auth');
  if (err instanceof Anthropic.PermissionDeniedError) return new HttpError(502, 'Der Claude-Zugang hat keine Berechtigung für dieses Modell.', 'ai_permission');
  if (err instanceof Anthropic.RateLimitError) return new HttpError(429, 'Das Anfrage-Limit des Claude-Zugangs ist gerade erreicht. Bitte später erneut versuchen – es wird nicht automatisch wiederholt.', 'ai_rate_limit');
  if (status === 400 && /credit|balance|billing/i.test(msg)) return new HttpError(402, 'Das Guthaben bzw. Kontingent des Claude-Zugangs ist aufgebraucht. Bitte den Administrator informieren.', 'ai_quota');
  if (status === 529 || type === 'overloaded_error') return new HttpError(503, 'Claude ist gerade überlastet. Bitte in ein paar Minuten erneut versuchen.', 'ai_overloaded');
  if (err instanceof Anthropic.NotFoundError) return new HttpError(502, 'Das eingestellte Claude-Modell ist nicht verfügbar.', 'ai_model');
  if (err instanceof Anthropic.APIConnectionError) return new HttpError(502, 'Claude ist nicht erreichbar. Bitte Internetverbindung des Servers prüfen.', 'ai_connection');
  return new HttpError(502, `Die KI-Anfrage ist fehlgeschlagen: ${msg.slice(0, 200)}`, 'ai_error');
}

async function runClaude(user, feature, params) {
  const status = await aiStatus(user);
  if (!status.available) throw new HttpError(403, REASON_TEXT[status.reason] || 'KI nicht verfügbar', `ai_${status.reason}`);
  const s = await getSettings();
  const apiKey = decrypt(s.ai.api_key_enc);
  if (!apiKey) throw new HttpError(403, REASON_TEXT.not_configured, 'ai_not_configured');
  try {
    const res = await client(apiKey).messages.create({ model: s.ai.model || AI_MODELS[0], ...params });
    await knex('ai_usage').insert({ user_id: user.id, feature, status: 'ok', input_tokens: res.usage?.input_tokens || 0, output_tokens: res.usage?.output_tokens || 0 });
    if (res.stop_reason === 'refusal') throw new HttpError(422, 'Claude hat diese Anfrage abgelehnt.', 'ai_refusal');
    if (res.stop_reason === 'max_tokens') throw new HttpError(422, 'Das Rezept war zu lang für eine einzelne Anfrage.', 'ai_too_long');
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return text;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const fe = friendlyError(err);
    await knex('ai_usage').insert({ user_id: user.id, feature, status: 'error', input_tokens: 0, output_tokens: 0, error: fe.message.slice(0, 500) });
    throw fe;
  }
}

const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_recipe', 'title', 'description', 'servings', 'prep_minutes', 'cook_minutes', 'category', 'tags', 'ingredient_groups', 'steps', 'uncertain_notes'],
  properties: {
    is_recipe: { type: 'boolean' },
    title: { type: 'string' },
    description: { type: 'string' },
    servings: { type: 'string', description: 'Zahl der Portionen, leer wenn unbekannt' },
    prep_minutes: { type: 'string' },
    cook_minutes: { type: 'string' },
    category: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    ingredient_groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'items'],
        properties: {
          name: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['amount', 'unit', 'name', 'note', 'uncertain'],
              properties: {
                amount: { type: 'string' },
                unit: { type: 'string' },
                name: { type: 'string' },
                note: { type: 'string' },
                uncertain: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'uncertain'],
        properties: { text: { type: 'string' }, uncertain: { type: 'boolean' } },
      },
    },
    uncertain_notes: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM = `Du extrahierst Kochrezepte für eine Rezeptverwaltung. Übernimm Inhalte originalgetreu in der Sprache der Vorlage, erfinde nichts und ergänze keine fehlenden Zutaten oder Schritte.
- Gruppiere Zutaten nur, wenn die Vorlage Gruppen nennt (z. B. „Teig“, „Füllung“); sonst eine Gruppe mit leerem Namen.
- amount ist eine Zahl als Text (Dezimalpunkt, Brüche wie 1/2 umrechnen) oder leer; unit ist die Einheit wie in der Vorlage (g, ml, EL, TL, Prise …).
- Setze uncertain=true bei jeder Zutat oder jedem Schritt, den du nicht sicher lesen konntest (Handschrift, Flecken, abgeschnitten). Markiere unleserliche Wörter im Text zusätzlich mit [?].
- Beschreibe in uncertain_notes kurz, was unsicher war.
- Wenn kein Rezept erkennbar ist, setze is_recipe=false.`;

function toDraft(data) {
  const n = (v) => {
    const x = Number(String(v || '').replace(',', '.'));
    return Number.isFinite(x) && x > 0 ? x : null;
  };
  return {
    title: data.title || 'Erkanntes Rezept',
    description: data.description || '',
    servings: n(data.servings) || 4,
    prep_time: n(data.prep_minutes),
    cook_time: n(data.cook_minutes),
    category: data.category || null,
    tags: data.tags || [],
    ingredients: (data.ingredient_groups || []).map((g) => ({
      name: g.name || '',
      items: (g.items || []).map((i) => {
        const amount = n(i.amount);
        if (amount == null && !i.unit && /^\d/.test(i.name)) {
          const p = parseIngredientLine(i.name);
          return { ...p, uncertain: !!i.uncertain };
        }
        return { amount, unit: i.unit || '', name: i.name, note: i.note || '', uncertain: !!i.uncertain };
      }),
    })),
    steps: (data.steps || []).map((s) => ({ text: s.text, uncertain: !!s.uncertain })),
    uncertain_notes: data.uncertain_notes || [],
  };
}

function parseOutput(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, 'Die KI-Antwort konnte nicht gelesen werden.', 'ai_parse');
  }
}

export async function recognizeFromImages(user, imageRels) {
  const content = [];
  for (const rel of imageRels.slice(0, 6)) {
    const buf = await readImageForAi(rel);
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } });
  }
  content.push({ type: 'text', text: 'Lies das Rezept auf diesen Fotos aus (gedruckt oder handschriftlich). Mehrere Fotos gehören zum selben Rezept.' });
  const text = await runClaude(user, 'photo_import', {
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: RECIPE_SCHEMA } },
    messages: [{ role: 'user', content }],
  });
  const data = parseOutput(text);
  if (!data.is_recipe) throw new HttpError(422, 'Auf dem Foto wurde kein Rezept erkannt.', 'ai_no_recipe');
  return toDraft(data);
}

export async function extractFromText(user, pageText, url) {
  const text = await runClaude(user, 'url_import', {
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: RECIPE_SCHEMA } },
    messages: [{ role: 'user', content: `Extrahiere das Rezept aus diesem Webseiten-Text (${url}):\n\n<seite>\n${pageText}\n</seite>` }],
  });
  const data = parseOutput(text);
  if (!data.is_recipe) throw new HttpError(422, 'Auf der Seite wurde kein Rezept gefunden.', 'ai_no_recipe');
  return toDraft(data);
}

/** Prüft Schlüssel und Modell ohne kostenpflichtige Anfrage (Models-API). */
export async function testConnection(apiKey, model) {
  try {
    const m = await client(apiKey).models.retrieve(model);
    return { ok: true, model: m.id, display_name: m.display_name };
  } catch (err) {
    const fe = friendlyError(err);
    return { ok: false, error: fe.message };
  }
}
