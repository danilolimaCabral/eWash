import { createClient } from '@libsql/client';
const c = createClient({ url: 'file:/tmp/t11.db' });
await c.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)");
await c.execute("INSERT INTO t VALUES (1)");
const r = await c.execute("SELECT * FROM t");
console.log('rows:', r.rows);
await c.close();
console.log('closed');
