import path from 'node:path';

export function loadConfig(env = process.env) {
  const dataDir = env.DATA_DIR || 'data';
  return {
    port: Number(env.PORT) || 3000,
    dbFile: env.DB_FILE || path.join(dataDir, 'stundenzettel.db'),
    timeZone: env.APP_TIMEZONE || 'Europe/Berlin',
    // Hinter HTTPS-Proxy (z. B. Caddy, Nginx, Render, Railway) auf "true" setzen.
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : undefined,
    trustProxy: env.TRUST_PROXY ? (Number.isNaN(Number(env.TRUST_PROXY)) ? env.TRUST_PROXY : Number(env.TRUST_PROXY)) : false,
  };
}
