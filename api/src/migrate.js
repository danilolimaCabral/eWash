// LavTr — aplicação automática de migrations em libSQL/SQLite.
// Lê migrations/*.sql em ordem e aplica apenas as ainda não executadas,
// registrando cada uma em `_lavtr_migrations`.
import { createClient } from '@libsql/client';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

export async function applyMigrations(env) {
  const url = String(env.DATABASE_URL || '');
  if (!url) { console.log('skip migrations: no DATABASE_URL'); return; }
  const client = createClient({ url });
  try {
    await client.execute(`CREATE TABLE IF NOT EXISTS _lavtr_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT DEFAULT (datetime('now')) NOT NULL
    )`);
    const applied = await client.execute('SELECT name FROM _lavtr_migrations ORDER BY name');
    const appliedSet = new Set(applied.rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (appliedSet.has(f)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8');
      for (const stmt of sql.split('--> statement-breakpoint')) {
        const s = stmt.trim();
        if (s) await client.execute(s);
      }
      await client.execute({ sql: 'INSERT INTO _lavtr_migrations (name) VALUES (?)', args: [f] });
      console.log(`migration applied: ${f}`);
    }
    console.log(`migrations done (${files.length} total)`);
  } finally {
    client.close();
  }
}
