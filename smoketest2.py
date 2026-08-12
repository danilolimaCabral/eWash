import requests, json

BASE = 'http://localhost:8787/api'

# login do tenant criado no smoke test anterior
r = requests.post(f'{BASE}/auth/login', json={'email': 'danilo@teste.com', 'password': 'Senha123!'})
token = r.json()['token']
H = {'Authorization': f'Bearer {token}'}

# catálogo
s = requests.get(f'{BASE}/catalog', headers=H).json()
SERVICES = s.get('services', [])
print('== Catálogo (seed PT-BR):')
for svc in SERVICES:
    print(f"  - {svc['name']} | {svc['pricingModel']} | base R$ {svc['baseRateCents']/100:.2f}")

# cliente (já existia do teste anterior; obter id)
custs = requests.get(f'{BASE}/customers', headers=H).json()
custs_rows = custs.get('rows', custs) if isinstance(custs, dict) else custs
cid = custs_rows[0]['id']
print('\nCliente:', custs_rows[0]['name'], cid)

# branches do tenant
b = requests.get(f'{BASE}/branches', headers=H).json()
BRANCHES = b.get('rows', b) if isinstance(b, dict) else b
bid = BRANCHES[0]['id']
print('Branch:', BRANCHES[0]['name'])

# criar pedido com serviço "Lavagem por quilo"
svc = next((x for x in SERVICES if 'quilo' in x['name']), None)
if not svc:
    svc = SERVICES[0]
    print('  (usando serviço:', svc['name'], ')')
order = requests.post(f'{BASE}/orders', headers=H, json={
    'customer': {'name': 'Maria Silva', 'phone': '11988887777'},
    'branch_id': bid, 'items': [
        {'serviceId': svc['id'], 'qty': 6, 'unit': 'kg'}],
    'handoff_type': 'pickup', 'express': 0}).json()
print('\nPedido:', json.dumps(order, indent=1, ensure_ascii=False)[:400])
oid = order.get('order', {}).get('id') or order.get('id')

# registrar pagamento Pix (rota POST /api/payments)
if oid:
    paid = requests.post(f'{BASE}/orders/{oid}/payments', headers=H, json={
        'order_id': oid, 'method': 'pix_manual',
        'amount_cents': (order.get('order') or order).get('totalCents', 4800),
        'pix_ref': 'e2e12345-abc'}).json()
    print('\nPagamento Pix:', json.dumps(paid, ensure_ascii=False)[:400])
    if 'error' in paid:
        print('  (detalhe da rota payments abaixo)')

# dashboard tenant
d = requests.get(f'{BASE}/dashboard/kpis', headers=H).json()
print('\nDashboard:', json.dumps(d, ensure_ascii=False)[:300])
