import { Hono } from 'hono';
const app = new Hono();
app.post('/requests', c => c.json({ ok: true, t: c.req.query('tenant') }));
const resp = await app.fetch(new Request('http://x.test/requests?tenant=LV', { method: 'POST' }), {});
console.log('status:', resp.status, await resp.text());
