import path from 'node:path';

const isDbUrl = (v) => /^(libsql|https?|wss?):\/\//.test(String(v ?? ''));

// Turso-Zugangsdaten finden – auch wenn Vercel sie mit einem Präfix anlegt (z. B. STORAGE_TURSO_DATABASE_URL).
// Adresse und Schlüssel werden als Paar mit gleichem Präfix gesucht, damit nie zwei Datenbanken gemischt werden.
function findDatabase(env) {
  const keys = Object.keys(env).sort();
  const urlKey = [/^TURSO_DATABASE_URL$/, /^LIBSQL_URL$/, /TURSO.*URL$/, /LIBSQL.*URL$/]
    .map((re) => keys.find((k) => re.test(k) && isDbUrl(env[k])))
    .find(Boolean)
    ?? (isDbUrl(env.DATABASE_URL) && /^libsql:/.test(env.DATABASE_URL) ? 'DATABASE_URL' : null)
    ?? keys.find((k) => /^libsql:\/\//.test(String(env[k] ?? '')));
  if (!urlKey) return { url: '', token: undefined, variable: '' };

  const prefix = urlKey.replace(/(DATABASE_URL|URL)$/, '');
  const tokenKey = [`${prefix}AUTH_TOKEN`, `${prefix}TOKEN`].find((k) => env[k])
    ?? [/^TURSO_AUTH_TOKEN$/, /^LIBSQL_AUTH_TOKEN$/, /TURSO.*TOKEN$/, /LIBSQL.*TOKEN$/]
      .map((re) => keys.find((k) => re.test(k) && env[k]))
      .find(Boolean);
  return { url: env[urlKey], token: tokenKey ? env[tokenKey] : undefined, variable: urlKey };
}

// Für die Fehlersuche: Datenbank-Variablen mit Namen und – bei Adressen – nur dem Servernamen. Nie Schlüssel.
export function databaseOverview(env = process.env) {
  return Object.keys(env).filter((k) => /TURSO|LIBSQL|DATABASE/.test(k)).sort().map((name) => {
    let host = '';
    if (isDbUrl(env[name])) {
      try { host = new URL(env[name]).host; } catch { /* kein gültiger Wert */ }
    }
    return { name, host };
  });
}

// Die Turso-Anbindung von Vercel kann für jedes Deployment eine eigene Kopie anlegen ("dpl-…").
// Was dort gespeichert wird, ist nach dem nächsten Update weg.
export const isDeploymentDatabase = (dbUrl) => /^dpl-/.test(databaseHost(dbUrl));

// Servername der verwendeten Datenbank (ohne Zugangsdaten).
export function databaseHost(dbUrl) {
  if (!dbUrl || dbUrl.startsWith('file:')) return 'lokale Datei';
  try { return new URL(dbUrl).host; } catch { return 'unbekannt'; }
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
    dbVariable: remote.variable,
    // Auf Vercel gibt es keinen dauerhaften Speicher – dort muss eine Online-Datenbank verbunden sein.
    dbMissing: onVercel && !remote.url,
    // Jedes Vercel-Update hat eine eigene Adresse; dort kennt der Browser die Anmeldung nicht.
    // Deshalb werden diese Adressen auf die feste Hauptadresse umgeleitet.
    productionHost: env.VERCEL_ENV === 'production' ? String(env.VERCEL_PROJECT_PRODUCTION_URL ?? '').toLowerCase() : '',
    version: String(env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7),
    timeZone: env.APP_TIMEZONE || 'Europe/Berlin',
    // Hinter HTTPS-Proxy (z. B. Caddy, Nginx, Render, Railway) auf "true" setzen.
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : undefined,
    trustProxy: env.TRUST_PROXY
      ? (Number.isNaN(Number(env.TRUST_PROXY)) ? env.TRUST_PROXY : Number(env.TRUST_PROXY))
      : (onVercel ? 1 : false),
  };
}
