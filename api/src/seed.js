// Tenant onboarding: seed role templates, a typical Brazilian laundry template
// catalog (the activation key — spec §3), and default expense categories.
import { uid } from './util.js';
import { ROLE_TEMPLATES } from './policies.js';
import {
  roles, rolePolicies, serviceCategories, services, serviceVariants,
  pricingTiers, addonRules, expenseCategories,
} from './db/schema.js';

export const EXPENSE_CATEGORIES = [
  'Detergentes e suprimentos', 'Água', 'Energia elétrica', 'Aluguel',
  'Salários e encargos', 'Delivery/combustível', 'Equipamentos e manutenção', 'Outros',
];

export async function seedTenant(db, tenantId) {
  // --- roles + policies ---
  const roleIds = {};
  const roleRows = [];
  const policyRows = [];
  for (const [name, keys] of Object.entries(ROLE_TEMPLATES)) {
    const rid = uid();
    roleIds[name] = rid;
    roleRows.push({ id: rid, tenantId, name, isSystem: 1 });
    for (const key of keys) policyRows.push({ id: uid(), roleId: rid, policyKey: key, allow: 1 });
  }
  await db.insert(roles).values(roleRows);
  await db.insert(rolePolicies).values(policyRows);

  // --- expense categories ---
  await db.insert(expenseCategories).values(
    EXPENSE_CATEGORIES.map((name) => ({ id: uid(), tenantId, name, isDefault: 1 }))
  );

  // --- template catalog ---
  const catIds = {};
  const cats = ['Lavagem', 'Passadoria', 'Tinturaria a Seco', 'Itens Especiais', 'Cama, Mesa e Banho'];
  await db.insert(serviceCategories).values(
    cats.map((name, i) => {
      const cid = uid();
      catIds[name] = cid;
      return { id: cid, tenantId, name, sortOrder: i };
    })
  );

  const svc = (categoryName, name, pricingModel, rateKes, opts = {}) => ({
    id: uid(),
    tenantId,
    categoryId: catIds[categoryName],
    name,
    pricingModel,
    baseRateCents: rateKes * 100,
    minChargeCents: (opts.min || 0) * 100,
    expressPct: opts.expressPct ?? 50,
    unit: opts.unit || (pricingModel === 'PER_KG' ? 'kg' : pricingModel === 'FLAT' ? 'flat' : 'item'),
    active: 1,
  });

  const washKg = svc('Lavagem', 'Lavagem por quilo (kg)', 'PER_KG', 8, { min: 5 });
  const iron = svc('Passadoria', 'Passadoria', 'PER_KG', 6);
  const stain = svc('Lavagem', 'Tratamento de manchas', 'PER_ITEM', 10);
  const duvet = svc('Cama, Mesa e Banho', 'Lavagem de edredom', 'PER_ITEM', 45);
  const suit = svc('Tinturaria a Seco', 'Terno à seco', 'PER_ITEM', 45);
  const bag = svc('Lavagem', 'Lavagem de saco completo (qualquer peso)', 'FLAT', 60);
  const bedding = svc('Cama, Mesa e Banho', 'Kit de roupa de cama', 'TIERED', 45, { unit: 'kg' });
  await db.insert(services).values([washKg, iron, stain, duvet, suit, bag, bedding]);

  await db.insert(serviceVariants).values([
    { id: uid(), serviceId: duvet.id, attribute: 'size', label: 'Casal', priceCents: 4500, sortOrder: 0 },
    { id: uid(), serviceId: duvet.id, attribute: 'size', label: 'Queen', priceCents: 6000, sortOrder: 1 },
    { id: uid(), serviceId: duvet.id, attribute: 'size', label: 'King', priceCents: 8000, sortOrder: 2 },
  ]);

  await db.insert(pricingTiers).values([
    // Lavagem por quilo: 10+ kg cai para R$ 7/kg
    { id: uid(), serviceId: washKg.id, minQty: 10, maxQty: null, rateCents: 700, bandPriceCents: null },
    // Kit de roupa de cama por faixas: até 5 kg R$ 45, 5–10 kg R$ 75, 10+ kg R$ 120
    { id: uid(), serviceId: bedding.id, minQty: 0, maxQty: 5, rateCents: null, bandPriceCents: 4500 },
    { id: uid(), serviceId: bedding.id, minQty: 5.01, maxQty: 10, rateCents: null, bandPriceCents: 7500 },
    { id: uid(), serviceId: bedding.id, minQty: 10.01, maxQty: null, rateCents: null, bandPriceCents: 12000 },
  ]);

  await db.insert(addonRules).values([
    // Passadoria junto da lavagem sai por R$ 4/kg (avulsa R$ 6/kg), herda o peso
    { id: uid(), tenantId, parentServiceId: washKg.id, addonServiceId: iron.id, overrideRateCents: 400, inheritQty: 1 },
    { id: uid(), tenantId, parentServiceId: washKg.id, addonServiceId: stain.id, overrideRateCents: null, inheritQty: 0 },
    { id: uid(), tenantId, parentServiceId: duvet.id, addonServiceId: stain.id, overrideRateCents: null, inheritQty: 1 },
  ]);

  return { roleIds };
}
