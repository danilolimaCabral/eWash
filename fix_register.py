import pathlib

p = pathlib.Path('api/src/routes/auth.js')
t = p.read_text()
t = t.replace(".toUpperCase().replace(/[^A-Z]/g, '') || 'WK',",
              ".toUpperCase().replace(/[^A-Z]/g, '') || 'LV',")
p.write_text(t)

# Ver fluxo de ativação
t = pathlib.Path('api/src/routes/auth.js').read_text()
import re
m = re.search(r'activation', t)
print('activation refs:', len(re.findall(r'activation', t)))
