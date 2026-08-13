process.env.DATABASE_URL = 'file:/tmp/tfix2.db';
const { applyMigrations } = await import('./src/migrate.js');
await applyMigrations({ DATABASE_URL: 'file:/tmp/tfix2.db' });
const { seedTenant } = await import('./src/seed.js');
const { POLICY_KEYS } = await import('./src/policies.js');
const { createClient } = await import('@libsql/client');
const { drizzle } = await import('drizzle-orm/libsql');
const schema = await import('./src/db/schema.js');
const raw = createClient({ url: 'file:/tmp/tfix2.db' });
const db = drizzle(raw, { schema });
const T = '00000000-0000-0000-0000-000000000001';
const donoRoleId = '00000000-0000-0000-0000-000000000021';
// simula fixup
const demo = async (l, q) => { try { await raw.execute(q); console.log('ok', l); } catch(e) { console.log('FAIL', l, e.message); } };
for (const key of POLICY_KEYS) {
  await demo(`policy ${key}`, `INSERT OR IGNORE INTO role_policies (id, role_id, policy_key, allow) VALUES (HEX(RANDOMBLOB(16)), '${donoRoleId}', '${key}', 1)`);
}
await seedTenant(db, T);
console.log('done');
