// Pricing engine. Resolution order (spec §4.3):
//   1. service + variant → base strategy rate
//   2. quantity/weight → raw line amount (tiers applied here)
//   3. line-level minimum charge
//   4. each attached rider priced the same way (bundled override if set)
//   5. order-level modifiers: express surcharge, discount
//   6. caller snapshots the resolved prices onto the order rows
import { bad } from './util.js';
import { checkQty, checkMoney } from './security.js';

// Price one line for a service. `service` carries variants[] and tiers[].
export function priceLine(service, { qty, variantId = null, rateOverrideCents = null }) {
  checkQty(qty, `Quantity for ${service.name}`);
  let unitPrice;
  let amount;
  let variant = null;

  switch (service.pricingModel) {
    case 'PER_KG': {
      unitPrice = service.baseRateCents;
      // tier breaks: a matching band replaces the per-kg rate
      const tier = (service.tiers || []).find(
        (t) => qty >= t.minQty && (t.maxQty == null || qty <= t.maxQty) && t.rateCents != null
      );
      if (tier) unitPrice = tier.rateCents;
      if (rateOverrideCents != null) unitPrice = rateOverrideCents;
      amount = Math.round(unitPrice * qty);
      break;
    }
    case 'PER_ITEM': {
      if (variantId) {
        variant = (service.variants || []).find((v) => v.id === variantId);
        if (!variant) bad(`Unknown variant for ${service.name}`);
        unitPrice = variant.priceCents;
      } else {
        unitPrice = service.baseRateCents;
      }
      if (rateOverrideCents != null) unitPrice = rateOverrideCents;
      amount = Math.round(unitPrice * qty);
      break;
    }
    case 'FLAT': {
      unitPrice = rateOverrideCents ?? service.baseRateCents;
      amount = Math.round(unitPrice * Math.max(1, Math.round(qty)));
      break;
    }
    case 'TIERED': {
      const band = (service.tiers || []).find(
        (t) => qty >= t.minQty && (t.maxQty == null || qty <= t.maxQty)
      );
      if (band) {
        if (band.bandPriceCents != null) {
          unitPrice = band.bandPriceCents;
          amount = band.bandPriceCents;
        } else {
          unitPrice = band.rateCents ?? service.baseRateCents;
          amount = Math.round(unitPrice * qty);
        }
      } else {
        unitPrice = service.baseRateCents;
        amount = Math.round(unitPrice * qty);
      }
      if (rateOverrideCents != null) {
        unitPrice = rateOverrideCents;
        amount = Math.round(rateOverrideCents * qty);
      }
      break;
    }
    default:
      bad(`Unknown pricing model ${service.pricingModel}`);
  }

  let minApplied = false;
  if (service.minChargeCents > 0 && amount < service.minChargeCents) {
    amount = service.minChargeCents;
    minApplied = true;
  }
  return { unitPriceCents: unitPrice, lineTotalCents: amount, minApplied, variant };
}

// Price a whole order request against the catalog.
// items: [{ serviceId, variantId?, qty, addons: [{ addonServiceId, qty? }] }]
// serviceMap: Map<id, service+variants+tiers>, ruleMap: Map<`${parent}:${addon}`, rule>
export function priceOrder({ items, express, discountCents = 0 }, serviceMap, ruleMap) {
  if (!items?.length) bad('Order needs at least one line');
  const lines = [];
  let subtotal = 0;
  let expressCents = 0;

  for (const item of items) {
    const svc = serviceMap.get(item.serviceId);
    if (!svc || !svc.active) bad('Unknown or inactive service on order line');
    const base = priceLine(svc, { qty: item.qty, variantId: item.variantId || null });

    const addons = [];
    for (const a of item.addons || []) {
      const rule = ruleMap.get(`${item.serviceId}:${a.addonServiceId}`);
      if (!rule) bad('This add-on is not attachable to that service');
      const addonSvc = serviceMap.get(a.addonServiceId);
      if (!addonSvc || !addonSvc.active) bad('Unknown or inactive add-on service');
      // qty inheritance: same-unit riders inherit the parent qty unless overridden
      const inherited = rule.inheritQty === 1 && a.qty == null;
      const aq = a.qty != null ? a.qty : (rule.inheritQty ? item.qty : 1);
      const priced = priceLine(addonSvc, { qty: aq, rateOverrideCents: rule.overrideRateCents });
      addons.push({
        addonServiceId: addonSvc.id,
        addonName: addonSvc.name,
        qty: aq,
        qtyInherited: inherited ? 1 : 0,
        unit: addonSvc.unit,
        unitPriceCents: priced.unitPriceCents,
        totalCents: priced.lineTotalCents,
      });
      subtotal += priced.lineTotalCents;
      if (express) expressCents += Math.round(priced.lineTotalCents * (addonSvc.expressPct / 100));
    }

    lines.push({
      serviceId: svc.id,
      serviceName: svc.name,
      variantId: item.variantId || null,
      variantLabel: base.variant?.label || null,
      qty: item.qty,
      unit: svc.unit,
      unitPriceCents: base.unitPriceCents,
      minApplied: base.minApplied ? 1 : 0,
      lineTotalCents: base.lineTotalCents,
      addons,
    });
    subtotal += base.lineTotalCents;
    if (express) expressCents += Math.round(base.lineTotalCents * (svc.expressPct / 100));
  }

  discountCents = Math.max(0, Math.round(discountCents || 0));
  checkMoney(discountCents, 'Discount');
  checkMoney(subtotal + expressCents, 'Order amount');
  const total = Math.max(0, subtotal + expressCents - discountCents);
  if (discountCents > subtotal + expressCents) bad('Discount cannot exceed the order amount');
  return { lines, subtotalCents: subtotal, expressCents, discountCents, totalCents: total };
}
