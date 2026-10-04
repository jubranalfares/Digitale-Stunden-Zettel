// Minimaler Nachbau des Turso/libSQL-HTTP-Protokolls (Hrana v2, JSON) für Tests.
// So läuft der echte Online-Client (@libsql/client/web) gegen eine lokale SQLite-Datenbank.
import http from 'node:http';

const toValue = (v) => {
  if (v == null) return { type: 'null' };
  if (typeof v === 'bigint') return { type: 'integer', value: String(v) };
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  if (typeof v === 'string') return { type: 'text', value: v };
  return { type: 'blob', base64: Buffer.from(v).toString('base64') };
};

const fromValue = (v) => {
  switch (v?.type) {
    case 'integer': return Number(v.value);
    case 'float': return v.value;
    case 'text': return v.value;
    case 'blob': return Buffer.from(v.base64, 'base64');
    default: return null;
  }
};

export async function startHranaMock() {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  let requests = 0;
  const storedSql = new Map();

  const execute = (stmt) => {
    if (stmt.named_args?.length) throw new Error('Benannte Parameter werden in diesem Test nicht erwartet');
    const prepared = db.prepare(stmt.sql ?? storedSql.get(stmt.sql_id));
    const args = (stmt.args ?? []).map(fromValue);
    if (prepared.columns().length) {
      prepared.setReturnArrays?.(true);
      const rows = prepared.all(...args);
      const cols = prepared.columns().map((c) => ({ name: c.name, decltype: null }));
      const asArrays = rows.map((r) => (Array.isArray(r) ? r : Object.values(r)));
      return { cols, rows: asArrays.map((r) => r.map(toValue)), affected_row_count: 0, last_insert_rowid: null };
    }
    const info = prepared.run(...args);
    return { cols: [], rows: [], affected_row_count: Number(info.changes), last_insert_rowid: String(info.lastInsertRowid) };
  };

  const runBatch = (batch) => {
    const results = [];
    const errors = [];
    const check = (cond) => {
      if (!cond) return true;
      switch (cond.type) {
        case 'ok': return results[cond.step] != null;
        case 'error': return errors[cond.step] != null;
        case 'not': return !check(cond.cond);
        case 'and': return cond.conds.every(check);
        case 'or': return cond.conds.some(check);
        case 'is_autocommit': return !db.isTransaction;
        default: throw new Error(`Unbekannte Bedingung ${cond.type}`);
      }
    };
    batch.steps.forEach((step, i) => {
      results[i] = null;
      errors[i] = null;
      if (!check(step.condition)) return;
      try {
        results[i] = execute(step.stmt);
      } catch (err) {
        errors[i] = { message: err.message };
      }
    });
    return { step_results: results, step_errors: errors };
  };

  const handle = (req) => {
    switch (req.type) {
      case 'execute': return { type: 'execute', result: execute(req.stmt) };
      case 'batch': return { type: 'batch', result: runBatch(req.batch) };
      case 'sequence': db.exec(req.sql); return { type: 'sequence' };
      case 'get_autocommit': return { type: 'get_autocommit', is_autocommit: !db.isTransaction };
      case 'store_sql': storedSql.set(req.sql_id, req.sql); return { type: 'store_sql' };
      case 'close_sql': storedSql.delete(req.sql_id); return { type: 'close_sql' };
      case 'close': return { type: 'close' };
      default: throw new Error(`Unbekannte Anfrage ${req.type}`);
    }
  };

  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      // Nur Protokoll v2 anbieten
      res.writeHead(req.url === '/v2' ? 200 : 404).end();
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requests += 1;
      const { requests: reqs } = JSON.parse(body);
      const results = reqs.map((r) => {
        try {
          return { type: 'ok', response: handle(r) };
        } catch (err) {
          return { type: 'error', error: { message: err.message } };
        }
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ baton: reqs.some((r) => r.type === 'close') ? null : 'test-baton', base_url: null, results }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    get requests() { return requests; },
    close: () => { server.close(); db.close(); },
  };
}
