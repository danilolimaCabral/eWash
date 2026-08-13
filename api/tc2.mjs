import { createClient } from '@libsql/client';
const c = createClient({ url: 'file:/tmp/t8b.db' });
await c.execute(`CREATE TABLE IF NOT EXISTS _lavtr_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT)`);
console.log('created');
const r = await c.execute('SELECT name FROM _lavtr_migrations ORDER BY name');
console.log('rows:', r.rows.length);
await c.execute("INSERT INTO _lavtr_migrations (name) VALUES ('x')");
const r2 = await c.execute('SELECT name FROM _lavtr_migrations');
console.log('names:', r2.rows.map(r=>r.name));
