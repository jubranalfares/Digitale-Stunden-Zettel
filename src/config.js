import path from 'node:path';

const isDbUrl = (v) => /^(libsql|https?|wss?):\/\//.test(String(v ?? ''));

// Turso-Zugangsdaten finden – auch wenn Vercel sie mit einem Präfix anlegt (z. B. STORAGE_TURSO_DATABASE_URL).
function findDatabase(env) {
  const keys = Object.keys(env);
  const pick = (patterns, valid = (v) => !!v) => {
    for (const re of patterns) {
      const key = keys.find((k) => re.test(k) && valid(env[k]));
      if (key) return env[key];
    }
    return '';
  };
  const url = pick([/^TURSO_DATABASE_URL$/, /^LIBSQL_URL$/, /TURSO.*URL$/, /LIBSQL.*URL$/], isDbUrl)
    || (isDbUrl(env.DATABASE_URL) && /^libsql:/.test(env.DATABASE_URL) ? env.DATABASE_URL : '')
    || pick([/./], (v) => /^libsql:\/\//.test(String(v ?? '')));
  const token = pick([/^TURSO_AUTH_TOKEN$/, /^LIBSQL_AUTH_TOKEN$/, /TURSO.*TOKEN$/, /LIBSQL.*TOKEN$/]);
  return { url, token: token || undefined };
}

// Namen (nie Werte!) von Variablen, die nach Datenbank aussehen – hilft bei der Einrichtung.
export function databaseVariableNames(env = process.env) {
  return Object.keys(env).filter((k) => /TURSO|LIBSQL|DATABASE/.test(k)).sort();
}

export function loadConfig(env = process.env) {
  const dataDir = env.DATA_DIR || 'data';
  const onVercel = !!env.VERCEL;
  const remote = findDatabase(env);
  return {
    port: Number(env.PORT) || 3000,
    // Online (Turso/libSQL) oder lokal als Datei.
    dbUrl: remote.url || `file:${env.DB_FILE || path.join(dataDir, 'stundenzettel.db')}`,
    dbAuthToken: remote.token,
    // Auf Vercel gibt es keinen dauerhaften Speicher – dort muss eine Online-Datenbank verbunden sein.
    dbMissing: onVercel && !remote.url,
    timeZone: env.APP_TIMEZONE || 'Europe/Berlin',
    // Hinter HTTPS-Proxy (z. B. Caddy, Nginx, Render, Railway) auf "true" setzen.
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : undefined,
    trustProxy: env.TRUST_PROXY
      ? (Number.isNaN(Number(env.TRUST_PROXY)) ? env.TRUST_PROXY : Number(env.TRUST_PROXY))
      : (onVercel ? 1 : false),
  };
}
