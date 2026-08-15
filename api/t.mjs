import { Hono } from 'hono';
const sub = new Hono();
sub.post('/requests', c => c.json({ok:1}));
const pApp = new Hono();
pApp.onError((err, c) => c.json({error: String(err.message), s: err.status}, err.status||500));
pApp.route('/api/public', sub);
const r = await pApp.fetch(new Request('http://x.test/api/public/requests?tenant=LV',{method:'POST'}), {});
console.log(r.status, await r.text());
