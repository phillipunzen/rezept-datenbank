import express from 'express';
import multer from 'multer';
import { knex, parseJson, json } from '../db.js';
import { requireAuth } from '../auth.js';
import { assertGroupRole, visibleRecipes } from '../access.js';
import { ah, badRequest, notFound, toInt } from '../util.js';
import { importFromUrl, attachRemoteImage, parseImportFile, tandoorList, tandoorRecipe } from '../services/importers.js';
import { recognizeFromImages, extractFromText, aiStatus } from '../services/ai.js';
import { createRecipe } from '../services/recipes.js';
import { addToCookbook } from './recipes.js';

const r = express.Router();
r.use(requireAuth);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

r.get('/ai/status', ah(async (req, res) => {
  res.json(await aiStatus(req.user));
}));

r.post('/import/url', ah(async (req, res) => {
  const url = String(req.body.url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw badRequest('Bitte einen vollständigen Link (https://…) eingeben');
  let result;
  try {
    result = await importFromUrl(url);
  } catch (err) {
    throw badRequest(`Die Seite konnte nicht geladen werden (${err.message})`);
  }
  if (!result.found) {
    const ai = await aiStatus(req.user);
    return res.json({ found: false, title: result.title, ai_available: ai.available, ai_reason: ai.reason });
  }
  await attachRemoteImage(result.draft);
  res.json({ found: true, draft: result.draft, warnings: result.warnings });
}));

r.post('/import/url/ai', ah(async (req, res) => {
  const url = String(req.body.url || '').trim();
  const result = await importFromUrl(url).catch((err) => { throw badRequest(`Die Seite konnte nicht geladen werden (${err.message})`); });
  if (result.found) {
    await attachRemoteImage(result.draft);
    return res.json({ found: true, draft: result.draft, warnings: result.warnings });
  }
  const draft = await extractFromText(req.user, result.page_text, url);
  draft.source_url = url;
  if (result.image) {
    draft._remote_image = result.image;
    await attachRemoteImage(draft);
  }
  res.json({ found: true, draft, warnings: draft.uncertain_notes || [], ai: true });
}));

r.post('/import/photo', ah(async (req, res) => {
  const images = (Array.isArray(req.body.images) ? req.body.images : []).filter((p) => /^recipes\/[\w-]+\.webp$/.test(p));
  if (!images.length) throw badRequest('Bitte mindestens ein Foto hochladen');
  const draft = await recognizeFromImages(req.user, images);
  draft.source_note = 'Aus Foto erkannt';
  res.json({ draft, warnings: draft.uncertain_notes || [] });
}));

r.post('/import/file', upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw badRequest('Keine Datei empfangen');
  const { drafts, errors } = await parseImportFile(req.file.buffer, req.file.originalname || 'datei');
  if (!drafts.length) throw badRequest(errors[0] || 'In der Datei wurden keine Rezepte gefunden');
  res.json({ drafts: await markDuplicates(req.user, drafts), errors });
}));

async function markDuplicates(user, drafts) {
  const existing = await knex('recipes as r').whereNull('r.deleted_at').where(visibleRecipes(user.id)).select('r.title', 'r.source_url', 'r.source_note');
  const titles = new Set(existing.map((e) => e.title.toLowerCase().trim()));
  const sources = new Set(existing.map((e) => e.source_url).filter(Boolean));
  const notes = existing.map((e) => e.source_note || '').join('\n');
  return drafts.map((d) => ({
    ...d,
    _duplicate: titles.has(String(d.title || '').toLowerCase().trim())
      || (d.source_url && sources.has(d.source_url))
      || (d._tandoor_id != null && notes.includes(`ID ${d._tandoor_id})`)),
  }));
}

// ---------- Tandoor ----------

r.post('/import/tandoor/list', ah(async (req, res) => {
  const url = String(req.body.url || '').trim();
  const tkn = String(req.body.token || '').trim();
  if (!/^https?:\/\//.test(url) || !tkn) throw badRequest('Bitte Tandoor-Adresse und API-Token angeben');
  let list;
  try {
    list = await tandoorList(url, tkn);
  } catch (err) {
    throw badRequest(`Verbindung zu Tandoor fehlgeschlagen: ${err.message}. Prüfe Adresse und Token (Tandoor → Einstellungen → API).`);
  }
  const marked = await markDuplicates(req.user, list.map((x) => ({ title: x.name, _tandoor_id: x.id, image: x.image, description: x.description })));
  res.json({ items: marked.map((m) => ({ id: m._tandoor_id, name: m.title, image: m.image, description: m.description, duplicate: m._duplicate })) });
}));

// ---------- Hintergrund-Importe mit Fortschritt ----------

async function runJob(jobId, user, items, worker, opts) {
  const report = { imported: [], skipped: [], failed: [] };
  let done = 0;
  for (const item of items) {
    try {
      const draft = await worker(item);
      if (!draft) {
        report.skipped.push({ title: item.title || item.name || String(item.id), reason: 'Nicht gefunden' });
      } else {
        delete draft._tandoor_id;
        delete draft._duplicate;
        await attachRemoteImage(draft);
        const id = await createRecipe(user, draft, { groupId: opts.groupId, changeNote: opts.note });
        if (opts.cookbookId) await addToCookbook(user, opts.cookbookId, id).catch(() => {});
        report.imported.push({ id, title: draft.title });
      }
    } catch (err) {
      report.failed.push({ title: item.title || item.name || String(item.id), reason: err.message });
    }
    done++;
    if (done % 2 === 0 || done === items.length) {
      await knex('import_jobs').where({ id: jobId }).update({ done, report: json(report) });
    }
  }
  await knex('import_jobs').where({ id: jobId }).update({ status: 'done', done, report: json(report), finished_at: knex.fn.now() });
}

async function startJob(req, type, items, worker, note) {
  const groupId = toInt(req.body.group_id);
  if (groupId) await assertGroupRole(req.user, groupId, 'editor');
  const cookbookId = toInt(req.body.cookbook_id);
  const [id] = await knex('import_jobs').insert({ user_id: req.user.id, type, total: items.length, done: 0, report: json({ imported: [], skipped: [], failed: [] }) });
  runJob(id, req.user, items, worker, { groupId, cookbookId, note }).catch(async (err) => {
    await knex('import_jobs').where({ id }).update({ status: 'failed', report: json({ imported: [], skipped: [], failed: [{ title: '-', reason: err.message }] }) });
  });
  return id;
}

r.post('/import/tandoor/run', ah(async (req, res) => {
  const url = String(req.body.url || '').trim();
  const tkn = String(req.body.token || '').trim();
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean);
  if (!ids.length) throw badRequest('Bitte mindestens ein Rezept auswählen');
  const id = await startJob(req, 'tandoor', ids.map((x) => ({ id: x })), (item) => tandoorRecipe(url, tkn, item.id), 'Aus Tandoor importiert');
  res.status(201).json({ job_id: id });
}));

r.post('/import/bulk', ah(async (req, res) => {
  const drafts = Array.isArray(req.body.drafts) ? req.body.drafts : [];
  if (!drafts.length) throw badRequest('Keine Rezepte ausgewählt');
  if (drafts.length > 2000) throw badRequest('Höchstens 2000 Rezepte pro Import');
  const id = await startJob(req, 'file', drafts, async (d) => ({ ...d }), 'Aus Datei importiert');
  res.status(201).json({ job_id: id });
}));

r.get('/import/jobs', ah(async (req, res) => {
  const rows = await knex('import_jobs').where({ user_id: req.user.id }).orderBy('id', 'desc').limit(20);
  res.json({ items: rows.map((j) => ({ ...j, report: parseJson(j.report) })) });
}));

r.get('/import/jobs/:id', ah(async (req, res) => {
  const j = await knex('import_jobs').where({ id: toInt(req.params.id), user_id: req.user.id }).first();
  if (!j) throw notFound();
  res.json({ ...j, report: parseJson(j.report) });
}));

export default r;
