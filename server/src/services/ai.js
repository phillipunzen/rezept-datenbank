// Zentrale Claude-Verbindung. Zwei Wege:
// 1. API-Schlüssel (Claude Console): vom Administrator hinterlegt, optional für alle Benutzer freigegeben.
// 2. Claude Code mit eigenem Abo: Der Administrator hinterlegt ein Token aus `claude setup-token`.
//    Es wird nur für genau diesen Benutzer verwendet – Anthropic erlaubt nicht, Abo-Zugänge
//    für andere Personen zu nutzen. Andere Benutzer fallen auf den API-Schlüssel zurück.
// Es gibt keine automatischen Wiederholungen oder Hintergrundanfragen – jede Anfrage
// wird ausschließlich durch eine ausdrückliche Benutzeraktion ausgelöst und gezählt.
import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { knex } from '../db.js';
import { getSettings } from '../settings.js';
import { decrypt, HttpError } from '../util.js';
import { readImageForAi } from './images.js';
import { parseIngredientLine } from './ingredients.js';

export const AI_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
export const CC_MODELS = ['opus', 'sonnet', 'haiku'];

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

/** Welcher Zugang gilt für diesen Benutzer? 'claude_code' | 'api' | null */
function providerFor(ai, user) {
  if (ai.cc_enabled && ai.cc_token_enc && user && ai.cc_owner_id === user.id) return 'claude_code';
  if (ai.api_key_enc && ai.enabled && (ai.shared || user?.role === 'admin')) return 'api';
  return null;
}

export async function aiStatus(user) {
  const s = await getSettings();
  const ai = s.ai;
  const configured = !!ai.api_key_enc;
  const counts = await usageCounts(user?.id);
  const provider = providerFor(ai, user);
  let available = !!provider;
  let reason = null;
  if (!provider) {
    if (ai.cc_enabled && ai.cc_token_enc && !configured) reason = 'cc_owner_only';
    else if (!configured) reason = 'not_configured';
    else if (!ai.enabled) reason = 'disabled';
    else reason = 'not_shared';
  } else if (ai.monthly_limit && counts.month >= ai.monthly_limit) { available = false; reason = 'monthly_limit'; }
  else if (ai.per_user_daily_limit && counts.day >= ai.per_user_daily_limit) { available = false; reason = 'daily_limit'; }
  return {
    available,
    reason,
    provider,
    configured,
    enabled: !!ai.enabled,
    shared: !!ai.shared,
    model: provider === 'claude_code' ? ai.cc_model : ai.model,
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
  cc_owner_only: 'Die KI-Verbindung nutzt das persönliche Claude-Abo des Administrators und steht deshalb nur ihm zur Verfügung.',
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

async function runApi(user, feature, apiKey, model, params) {
  try {
    const res = await client(apiKey).messages.create({ model: model || AI_MODELS[0], ...params });
    await knex('ai_usage').insert({ user_id: user.id, feature, status: 'ok', input_tokens: res.usage?.input_tokens || 0, output_tokens: res.usage?.output_tokens || 0 });
    if (res.stop_reason === 'refusal') throw new HttpError(422, 'Claude hat diese Anfrage abgelehnt.', 'ai_refusal');
    if (res.stop_reason === 'max_tokens') throw new HttpError(422, 'Das Rezept war zu lang für eine einzelne Anfrage.', 'ai_too_long');
    return parseOutput(res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const fe = friendlyError(err);
    await knex('ai_usage').insert({ user_id: user.id, feature, status: 'error', input_tokens: 0, output_tokens: 0, error: fe.message.slice(0, 500) });
    throw fe;
  }
}

// ---------- Claude Code (eigenes Abo) ----------

/** Übersetzt Fehler aus `claude -p` in verständliche Meldungen. */
function ccError(out, stderr) {
  const status = out?.api_error_status;
  const msg = String(out?.result || stderr || '').trim();
  if (status === 401 || status === 403 || /authenticat|oauth|log ?in|expired|revoked|invalid api key/i.test(msg)) {
    return new HttpError(502, 'Das Claude-Code-Token ist ungültig oder abgelaufen. Erzeuge mit „claude setup-token“ ein neues und hinterlege es unter Administration → KI-Verbindung.', 'ai_auth');
  }
  if (status === 429 || /session limit|weekly limit|usage limit|hit your .*limit|rate limit/i.test(msg)) {
    return new HttpError(429, `Dein Claude-Kontingent ist gerade erschöpft (${msg.slice(0, 160)}). Es wird nicht automatisch wiederholt – versuche es nach dem Zurücksetzen des Limits erneut.`, 'ai_rate_limit');
  }
  if (/credit balance|spend limit|extra usage/i.test(msg)) {
    return new HttpError(402, `Für diese Anfrage wäre zusätzliche, kostenpflichtige Nutzung nötig (${msg.slice(0, 160)}). Sie wurde nicht ausgeführt.`, 'ai_quota');
  }
  if (status === 529 || /overloaded/i.test(msg)) return new HttpError(503, 'Claude ist gerade überlastet. Bitte in ein paar Minuten erneut versuchen.', 'ai_overloaded');
  if (/max.?turns/i.test(msg) || out?.subtype === 'error_max_turns') return new HttpError(422, 'Claude Code hat die Aufgabe nicht in der erlaubten Schrittzahl abgeschlossen.', 'ai_too_long');
  return new HttpError(502, `Claude Code meldet einen Fehler: ${msg.slice(0, 200) || 'unbekannt'}`, 'ai_error');
}

function claudeCodeEnv(token) {
  // Bewusst minimale Umgebung: kein ANTHROPIC_API_KEY o. Ä., damit nie auf API-Abrechnung ausgewichen wird.
  const home = path.join(config.dataDir, 'claude-code');
  return {
    PATH: process.env.PATH,
    HOME: home,
    CLAUDE_CONFIG_DIR: path.join(home, 'config'),
    CLAUDE_CODE_OAUTH_TOKEN: token,
    CLAUDE_CODE_MAX_RETRIES: '0',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_UPDATES: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    LANG: 'C.UTF-8',
  };
}

/** Führt `claude -p` aus und liefert das geparste JSON-Ergebnis. */
function execClaudeCode({ token, model, prompt, schema, images = [], cwd, timeoutMs = 300000 }) {
  const args = [
    '-p', prompt,
    '--output-format', 'json',
    '--model', model || 'opus',
    '--max-turns', String(images.length + 3),
    '--tools', images.length ? 'Read' : '',
    '--permission-mode', 'dontAsk',
    '--no-session-persistence',
    '--strict-mcp-config',
  ];
  if (images.length) args.push('--allowedTools', 'Read', '--add-dir', cwd);
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('claude', args, { cwd, env: claudeCodeEnv(token), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(err);
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      let out = null;
      try { out = JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1)); } catch { /* kein JSON */ }
      resolve({ code, signal, out, stderr: stderr.slice(-2000) });
    });
  });
}

async function runClaudeCode(user, feature, ai, { prompt, schema, images = [] }) {
  const token = decrypt(ai.cc_token_enc);
  if (!token) throw new HttpError(403, REASON_TEXT.not_configured, 'ai_not_configured');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-cc-'));
  await fs.mkdir(path.join(config.dataDir, 'claude-code', 'config'), { recursive: true });
  try {
    const files = [];
    for (const [i, buf] of images.entries()) {
      const f = path.join(dir, `foto-${i + 1}.jpg`);
      await fs.writeFile(f, buf);
      files.push(f);
    }
    const fullPrompt = files.length
      ? `${prompt}\n\nDie Fotos liegen hier – lies jede Datei mit dem Read-Werkzeug:\n${files.join('\n')}`
      : prompt;
    let res;
    try {
      res = await execClaudeCode({ token, model: ai.cc_model, prompt: fullPrompt, schema, images: files, cwd: dir });
    } catch (err) {
      const e = err.code === 'ENOENT'
        ? new HttpError(502, 'Claude Code ist in diesem Container nicht installiert.', 'ai_cc_missing')
        : new HttpError(502, `Claude Code konnte nicht gestartet werden: ${err.message}`, 'ai_error');
      await knex('ai_usage').insert({ user_id: user.id, feature, status: 'error', input_tokens: 0, output_tokens: 0, error: e.message.slice(0, 500) });
      throw e;
    }
    const usage = res.out?.usage || {};
    const tokensIn = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
    if (res.signal || res.code !== 0 || !res.out || res.out.is_error) {
      const e = res.signal ? new HttpError(504, 'Claude Code hat zu lange gebraucht und wurde abgebrochen.', 'ai_timeout') : ccError(res.out, res.stderr);
      await knex('ai_usage').insert({ user_id: user.id, feature: `${feature}_cc`, status: 'error', input_tokens: tokensIn, output_tokens: usage.output_tokens || 0, error: e.message.slice(0, 500) });
      throw e;
    }
    await knex('ai_usage').insert({ user_id: user.id, feature: `${feature}_cc`, status: 'ok', input_tokens: tokensIn, output_tokens: usage.output_tokens || 0 });
    if (!schema) return res.out.result;
    if (res.out.structured_output && typeof res.out.structured_output === 'object') return res.out.structured_output;
    const text = String(res.out.result || '');
    return parseOutput(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Führt eine Extraktion über den passenden Zugang aus. */
async function runExtraction(user, feature, { images = [], text, effort }) {
  const status = await aiStatus(user);
  if (!status.available) throw new HttpError(403, REASON_TEXT[status.reason] || 'KI nicht verfügbar', `ai_${status.reason}`);
  const { ai } = await getSettings();
  if (status.provider === 'claude_code') {
    return runClaudeCode(user, feature, ai, { prompt: `${SYSTEM}\n\n${text}`, schema: RECIPE_SCHEMA, images });
  }
  const apiKey = decrypt(ai.api_key_enc);
  if (!apiKey) throw new HttpError(403, REASON_TEXT.not_configured, 'ai_not_configured');
  const content = images.map((buf) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } }));
  content.push({ type: 'text', text });
  return runApi(user, feature, apiKey, ai.model, {
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort, format: { type: 'json_schema', schema: RECIPE_SCHEMA } },
    messages: [{ role: 'user', content }],
  });
}

/** Prüft das Claude-Code-Token mit einer sehr kleinen, ausdrücklich ausgelösten Anfrage. */
export async function testClaudeCode(user) {
  const { ai } = await getSettings();
  const token = decrypt(ai.cc_token_enc);
  if (!token) return { ok: false, error: 'Kein Token hinterlegt.' };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-cc-'));
  await fs.mkdir(path.join(config.dataDir, 'claude-code', 'config'), { recursive: true });
  try {
    const res = await execClaudeCode({ token, model: 'haiku', prompt: 'Antworte nur mit: OK', cwd: dir, timeoutMs: 90000 });
    const usage = res.out?.usage || {};
    await knex('ai_usage').insert({ user_id: user.id, feature: 'test_cc', status: res.out && !res.out.is_error ? 'ok' : 'error', input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0 });
    if (res.code === 0 && res.out && !res.out.is_error) return { ok: true, result: String(res.out.result || '').slice(0, 50) };
    return { ok: false, error: ccError(res.out, res.stderr).message };
  } catch (err) {
    return { ok: false, error: err.code === 'ENOENT' ? 'Claude Code ist in diesem Container nicht installiert.' : err.message };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
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
  const status = await aiStatus(user);
  if (!status.available) throw new HttpError(403, REASON_TEXT[status.reason] || 'KI nicht verfügbar', `ai_${status.reason}`);
  const images = [];
  for (const rel of imageRels.slice(0, 6)) {
    try {
      images.push(await readImageForAi(rel));
    } catch {
      throw new HttpError(400, 'Ein Foto wurde nicht gefunden. Bitte erneut hochladen.', 'bad_request');
    }
  }
  const data = await runExtraction(user, 'photo_import', {
    images,
    effort: 'medium',
    text: 'Lies das Rezept auf diesen Fotos aus (gedruckt oder handschriftlich). Mehrere Fotos gehören zum selben Rezept.',
  });
  if (!data.is_recipe) throw new HttpError(422, 'Auf dem Foto wurde kein Rezept erkannt.', 'ai_no_recipe');
  return toDraft(data);
}

export async function extractFromText(user, pageText, url) {
  const data = await runExtraction(user, 'url_import', {
    effort: 'low',
    text: `Extrahiere das Rezept aus diesem Webseiten-Text (${url}):\n\n<seite>\n${pageText}\n</seite>`,
  });
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
