// LavTr database layer — libSQL (Railway + libsql://) ou D1 (Cloudflare).
// LibSQL fala o dialeto SQLite usado por todo o schema Drizzle — zero mudanças.
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema.js';

export function getDb(env) {
  if (env.DATABASE_URL) {
    let url = String(env.DATABASE_URL);
    // Node: aceita file:/tmp/x.db (libSQL exige file: como scheme válido)
    url = /^file:/.test(url) ? url : url;
    return drizzle(createClient({ url }), { schema });
  }
  return drizzle(env.DB, { schema });
}

export { schema, createClient };
