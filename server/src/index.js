import express from 'express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { config, uploadsDir } from './config.js';
import { knex, initDb } from './db.js';
import { loadUser, requireAuth } from './auth.js';
import { HttpError } from './util.js';
import { subscribe } from './events.js';
import { ensureDirs } from './services/images.js';
import { startHaPolling } from './services/homeassistant.js';
import authRoutes from './routes/auth.js';
import recipeRoutes from './routes/recipes.js';
import importRoutes from './routes/imports.js';
import collabRoutes from './routes/collab.js';
import planningRoutes from './routes/planning.js';
import publicRoutes from './routes/public.js';
import accountRoutes from './routes/account.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = process.env.WEB_DIR || path.resolve(here, '../../web/dist');

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression({ filter: (req, res) => req.path !== '/api/events' && compression.filter(req, res) }));
app.use(express.json({ limit: '60mb' }));
app.use(cookieParser());
app.use(loadUser);

app.get('/api/health', async (_req, res) => {
  try {
    await knex.raw('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);

app.get('/api/events', requireAuth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const unsub = subscribe(req.user.id, res);
  req.on('close', unsub);
});

app.use('/api', recipeRoutes);
app.use('/api', importRoutes);
app.use('/api', collabRoutes);
app.use('/api', planningRoutes);
app.use('/api', accountRoutes);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Unbekannter API-Pfad', 'not_found')));

app.use('/uploads', express.static(uploadsDir, { maxAge: '365d', immutable: true, fallthrough: false }));

if (fs.existsSync(webDir)) {
  app.use(express.static(webDir, {
    index: false,
    setHeaders(res, file) {
      if (/sw\.js$|workbox-|manifest\.webmanifest$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
      else if (/\/assets\//.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(webDir, 'index.html'));
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Die Datei ist zu groß', code: 'too_large' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Die Anfrage ist zu groß', code: 'too_large' });
  if (err?.status === 404 && req.path.startsWith('/uploads')) return res.status(404).end();
  console.error(err);
  res.status(500).json({ error: 'Interner Fehler', code: 'internal' });
});

async function bootstrapAdmin() {
  if (!config.admin.email || !config.admin.password) return;
  const exists = await knex('users').whereRaw('LOWER(email) = ?', [config.admin.email.toLowerCase()]).first();
  if (exists) return;
  await knex('users').insert({
    email: config.admin.email.toLowerCase(),
    display_name: 'Administrator',
    password_hash: await bcrypt.hash(config.admin.password, 11),
    role: 'admin',
  });
  console.log(`[setup] Administrator ${config.admin.email} angelegt`);
}

async function main() {
  await ensureDirs();
  await initDb();
  await bootstrapAdmin();
  startHaPolling();
  app.listen(config.port, () => console.log(`[rezeptbuch] läuft auf Port ${config.port} (${config.appUrl})`));
}

main().catch((err) => {
  console.error('Start fehlgeschlagen:', err);
  process.exit(1);
});
