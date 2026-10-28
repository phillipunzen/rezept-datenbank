import path from 'node:path';
import crypto from 'node:crypto';

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  appUrl: (env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  secret: env.APP_SECRET || '',
  dataDir: env.DATA_DIR || path.resolve('data'),
  db: {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'rezeptbuch',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'rezeptbuch',
  },
  oidc: {
    issuer: env.OIDC_ISSUER || '',
    clientId: env.OIDC_CLIENT_ID || '',
    clientSecret: env.OIDC_CLIENT_SECRET || '',
    name: env.OIDC_NAME || 'Authentik',
    adminGroup: env.OIDC_ADMIN_GROUP || '',
    scopes: env.OIDC_SCOPES || 'openid email profile',
  },
  admin: {
    email: env.ADMIN_EMAIL || '',
    password: env.ADMIN_PASSWORD || '',
  },
  secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : (env.APP_URL || '').startsWith('https'),
};

if (!config.secret || config.secret.length < 16) {
  if (env.NODE_ENV === 'production') {
    console.error('APP_SECRET muss gesetzt sein (mindestens 16 Zeichen).');
    process.exit(1);
  }
  config.secret = 'dev-secret-' + crypto.createHash('sha256').update(config.dataDir).digest('hex');
  console.warn('[config] APP_SECRET fehlt – nutze unsicheres Entwicklungs-Secret.');
}

export const uploadsDir = path.join(config.dataDir, 'uploads');
