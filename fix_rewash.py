import pathlib

for p in ['api/src/db/schema.js', 'api/src/routes/finance.js', 'api/src/routes/orders.js',
          'web/src/views/FinanceView.vue']:
    f = pathlib.Path(p)
    t = f.read_text()
    t = t.replace('rlavtr', 'rewash')
    f.write_text(t)
    print(p, 'ok')
