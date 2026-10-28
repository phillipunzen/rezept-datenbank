// „Mit Claude verbinden“: steuert das offizielle `claude setup-token` im Container.
// Der Benutzer meldet sich im eigenen Browser bei Claude an und gibt den angezeigten Code ein;
// das daraus erzeugte Abo-Token wird direkt übernommen und nie im Klartext angezeigt.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { token as randomId, HttpError } from '../util.js';

const sessions = new Map(); // id -> { proc, raw, userId, dir, timer, codeSentAt }
const MAX_AGE = 10 * 60 * 1000;

const clean = (s) => s
  .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
  .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
  .replace(/\x1b[()][A-Z0-9]/g, '');

async function stop(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  clearTimeout(s.timer);
  try { s.proc.kill('SIGTERM'); } catch { /* bereits beendet */ }
  await fs.rm(s.dir, { recursive: true, force: true }).catch(() => {});
}

function waitFor(s, test, ms) {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      const hit = test(s.raw);
      if (hit || s.exited || Date.now() - started > ms) return resolve(hit || null);
      setTimeout(check, 250);
    };
    check();
  });
}

export async function startLogin(userId) {
  for (const [id, s] of sessions) if (s.userId === userId) await stop(id);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rb-cc-login-'));
  const env = {
    PATH: process.env.PATH,
    HOME: dir,
    CLAUDE_CONFIG_DIR: path.join(dir, 'config'),
    TERM: 'xterm-256color',
    BROWSER: 'true', // kein Browser im Container – der Link wird in der App angezeigt
    DISABLE_AUTOUPDATER: '1',
    DISABLE_UPDATES: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    LANG: 'C.UTF-8',
  };
  let proc;
  try {
    // `script` stellt ein Pseudo-Terminal bereit; breite Zeilen verhindern Umbrüche in Link und Token.
    proc = spawn('script', ['-qfec', 'stty cols 4000 rows 50; exec claude setup-token', '/dev/null'], { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw new HttpError(502, `Claude Code konnte nicht gestartet werden: ${err.message}`, 'ai_cc_missing');
  }
  const id = randomId(12);
  const s = { proc, raw: '', userId, dir, exited: false };
  s.timer = setTimeout(() => stop(id), MAX_AGE);
  proc.stdout.on('data', (d) => { s.raw += d; });
  proc.stderr.on('data', (d) => { s.raw += d; });
  proc.on('error', () => { s.exited = true; });
  proc.on('close', () => { s.exited = true; });
  sessions.set(id, s);

  const url = await waitFor(s, (raw) => raw.match(/https:\/\/[^\s\x07\x1b"]*oauth\/authorize\?[^\s\x07\x1b"]+/)?.[0], 25000);
  if (!url) {
    const out = clean(s.raw).slice(-300);
    await stop(id);
    throw new HttpError(502, /not found|ENOENT/i.test(out) || !out
      ? 'Claude Code ist in diesem Container nicht verfügbar.'
      : `Die Anmeldung konnte nicht gestartet werden: ${out}`, 'ai_cc_login');
  }
  return { id, url };
}

export async function finishLogin(userId, id, code) {
  const s = sessions.get(id);
  if (!s || s.userId !== userId) throw new HttpError(400, 'Die Anmeldung ist abgelaufen. Bitte erneut auf „Mit Claude verbinden“ klicken.', 'ai_cc_login');
  const value = String(code || '').trim();
  if (!value || /\s/.test(value)) throw new HttpError(400, 'Bitte den angezeigten Code vollständig einfügen.', 'bad_request');
  const before = s.raw.length;
  s.proc.stdin.write(value);
  await new Promise((r) => setTimeout(r, 300));
  s.proc.stdin.write('\r');
  const result = await waitFor(s, (raw) => {
    const tail = clean(raw.slice(before));
    const tok = tail.match(/sk-ant-oat\d*-[A-Za-z0-9_-]{20,}/);
    if (tok) return { token: tok[0] };
    const err = tail.match(/OAuth error:?([^\n]*?)(Press Enter|$)/i) || tail.match(/(error|failed)[^\n]{0,200}/i);
    if (err) return { error: (err[1] || err[0]).trim() };
    return null;
  }, 45000);
  await stop(id);
  if (result?.token) return result.token;
  if (result?.error && /wasn.t accepted|invalid|expired/i.test(result.error)) {
    throw new HttpError(400, 'Der Code wurde nicht angenommen – er war unvollständig, abgelaufen oder schon benutzt. Bitte erneut auf „Mit Claude verbinden“ klicken und den neuen Code vollständig einfügen.', 'ai_cc_login');
  }
  throw new HttpError(400, result?.error
    ? `Claude hat den Code nicht angenommen: ${result.error} Bitte erneut verbinden.`
    : 'Es kam keine Antwort von Claude. Bitte erneut verbinden.', 'ai_cc_login');
}

export async function cancelLogin(userId, id) {
  const s = sessions.get(id);
  if (s && s.userId === userId) await stop(id);
}
