import pathlib

p = pathlib.Path('api/src/routes/platform.js')
t = p.read_text()

# Planos em reais: Starter R$99, Pro R$199, Premium R$349
t = t.replace(
    "const DEFAULT_MONTHLY_CENTS = { starter: 1500_00, growth: 3500_00, enterprise: 7500_00 };",
    "const DEFAULT_MONTHLY_CENTS = { starter: 99_00, growth: 199_00, enterprise: 349_00 };"
)
t = t.replace(
    "{ id: uid(), code: 'starter', name: 'Starter', priceCents: DEFAULT_MONTHLY_CENTS.starter, trialDays: 14 },",
    "{ id: uid(), code: 'starter', name: 'Starter', priceCents: DEFAULT_MONTHLY_CENTS.starter, trialDays: 14 },"
)
t = t.replace(
    "{ id: uid(), code: 'growth', name: 'Growth', priceCents: DEFAULT_MONTHLY_CENTS.growth, trialDays: 14 },",
    "{ id: uid(), code: 'growth', name: 'Pro', priceCents: DEFAULT_MONTHLY_CENTS.growth, trialDays: 14 },"
)
t = t.replace(
    "{ id: uid(), code: 'enterprise', name: 'Enterprise', priceCents: DEFAULT_MONTHLY_CENTS.enterprise, trialDays: 14 },",
    "{ id: uid(), code: 'enterprise', name: 'Premium', priceCents: DEFAULT_MONTHLY_CENTS.enterprise, trialDays: 14 },"
)
# PlanPrice mensais: whole reais (100 centavos = 1 real) — multiply by 100
t = t.replace(
    "priceCents: Math.round((monthly * (1 - discount)) / 100) * 100, // whole shillings",
    "priceCents: Math.round(monthly * (1 - discount) * 100), // whole reais"
)

# Features descritivas em PT-BR (defaults por plano) — procurar bloco de features
p.write_text(t)
print('planos atualizados')
