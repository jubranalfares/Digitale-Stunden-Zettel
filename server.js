import { createApp } from './src/app.js';
import { loadConfig } from './src/config.js';

const config = loadConfig();
const app = createApp({ config });

// Auf Vercel ruft die Plattform die App direkt auf (siehe api/index.js).
if (!process.env.VERCEL) {
  const server = app.listen(config.port, () => {
    console.log(`Digitale Stundenzettel läuft auf http://localhost:${config.port} (Datenbank: ${config.dbUrl.replace(/\?.*$/, '')})`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export default app;
