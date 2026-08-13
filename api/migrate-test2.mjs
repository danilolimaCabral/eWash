// Teste: aplicar migrations 0005..0015 uma a uma no libsql para achar a que quebra
import { createClient } from '@libsql/client';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGR = '/home/ubuntu/eWash/api/migrations';
const DB = 'file:/tmp/t4.db';

const c = createClient({ url: DB });

// Base: criar tabelas mínimas compatíveis com o schema real é difícil;
// melhor: aplicar 0000-0004 do arquivo (mesmo código do migrate.js) e depois 0005+
async function runFile(f) {
  const sql = await readFile(join(MIGR, f), 'utf8');
  await c.execute(sql);
}

const files = (await readdir(MIGR)).filter((x) => x.endsWith('.sql') && !x.includes('meta')).sort();
const base = ['0000_init.sql', '0001_security-sessions.sql', '0002_perf-indexes.sql', '0003_google-auth.sql', '0004_order-handoff-record.sql'];
for (const f of base) await runFile(f);
console.log('base OK');

for (const f of files) {
  if (base.includes(f)) continue;
  try {
    await runFile(f);
    console.log('OK :', f);
  } catch (e) {
    console.log('FAIL:', f, '->', String(e).slice(0, 120));
    const sql = await readFile(join(MIGR, f), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const s = stmt.trim();
      if (!s) continue;
      try {
        await c.execute(s);
      } catch (e2) {
        console.log('  stmt FAIL:', s.slice(0, 90), '->', String(e2).slice(0, 160));
        break;
      }
    }
    break;
  }
}

const r = await c.execute("SELECT id, email, status FROM users WHERE email='demo@lavatr.app'");
console.log('users:', r.rows);
