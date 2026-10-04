// Füllt eine leere Datenbank mit Beispieldaten zum Ausprobieren.
//   npm run demo                 -> data/stundenzettel.db (bzw. DB_FILE / TURSO_DATABASE_URL)
//   node scripts/demo-data.js x.db
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { seedDemo } from './demo.js';
import { Store } from '../src/store.js';
import { todayISO } from '../src/time.js';

const config = loadConfig();
if (process.argv[2]) config.dbUrl = `file:${process.argv[2]}`;
const db = await openDatabase(config);
try {
  await seedDemo(new Store(db), { today: todayISO(config.timeZone) });
  console.log(`Beispieldaten angelegt in ${config.dbUrl}`);
  console.log('  Chef:        chef / chef1234');
  console.log('  Mitarbeiter: giulia, luca, sophie, … / test1234');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
