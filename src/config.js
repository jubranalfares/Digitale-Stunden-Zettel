import path from 'node:path';

export function loadConfig(env = process.env) {
  const dataDir = env.DATA_DIR || 'data';
  const onVercel = !!env.VERCEL;
  const remoteUrl = env.TURSO_DATABASE_URL || env.LIBSQL_URL
    || (/^(libsql|https?|wss?):/.test(env.DATABASE_URL ?? '') ? env.DATABASE_URL : '');
  return {
    port: Number(env.PORT) || 3000,
    // Online (Turso/libSQL) oder lokal als Datei.
    dbUrl: remoteUrl || `file:${env.DB_FILE || path.join(dataDir, 'stundenzettel.db')}`,
    dbAuthToken: env.TURSO_AUTH_TOKEN || env.LIBSQL_AUTH_TOKEN || undefined,
    // Auf Vercel gibt es keinen dauerhaften Speicher – dort muss eine Online-Datenbank verbunden sein.
    dbMissing: onVercel && !remoteUrl,
    timeZone: env.APP_TIMEZONE || 'Europe/Berlin',
    // Hinter HTTPS-Proxy (z. B. Caddy, Nginx, Render, Railway) auf "true" setzen.
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : undefined,
    trustProxy: env.TRUST_PROXY
      ? (Number.isNaN(Number(env.TRUST_PROXY)) ? env.TRUST_PROXY : Number(env.TRUST_PROXY))
      : (onVercel ? 1 : false),
  };
}
