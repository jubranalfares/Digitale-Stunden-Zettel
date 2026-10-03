import { createApp } from './src/app.js';
import { loadConfig } from './src/config.js';
import { openDatabase } from './src/db.js';

const config = loadConfig();
const db = openDatabase(config.dbFile);
const app = createApp({ db, config });

const server = app.listen(config.port, () => {
  console.log(`Digitale Stundenzettel läuft auf http://localhost:${config.port} (Datenbank: ${config.dbFile})`);
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
