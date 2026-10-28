import knexFactory from 'knex';
import { config } from './config.js';
import { runMigrations } from './db/migrations.js';

export const knex = knexFactory({
  client: 'mysql2',
  connection: { ...config.db, charset: 'utf8mb4', dateStrings: true, supportBigNumbers: true },
  pool: {
    min: 0,
    max: 10,
    afterCreate(conn, done) {
      conn.query("SET time_zone = '+00:00'", (err) => done(err, conn));
    },
  },
});

export async function initDb() {
  for (let attempt = 1; ; attempt++) {
    try {
      await knex.raw('SELECT 1');
      break;
    } catch (err) {
      if (attempt >= 30) throw err;
      console.log(`[db] Warte auf Datenbank (${err.code || err.message}) …`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await runMigrations(knex);
}

export function parseJson(v, fallback = null) {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

export const json = (v) => (v == null ? null : JSON.stringify(v));
