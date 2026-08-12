// Granular policy catalog (spec §7.1). Roles are templates over these keys;
// per-user overrides (grant/deny) beat the role — an explicit deny always wins.
export const POLICIES = [
  ['orders.create', 'Create & assess orders'],
  ['orders.discount', 'Apply manual discounts (capped)'],
  ['orders.void', 'Void / cancel orders'],
  ['orders.advance', 'Move orders through the pipeline'],
  ['payments.receive', 'Receber pagamentos (dinheiro / Pix)'],
  ['payments.refund', 'Issue refunds'],
  ['catalog.edit', 'Edit services & pricing'],
  ['expenses.create', 'Record expenses'],
  ['finance.view', 'View P&L, reports & registers'],
  ['finance.manage', 'Manage expenses, credit, providers & historical records'],
  ['users.manage', 'Manage users, roles & policies'],
  ['branches.manage', 'Manage branches and branch assignments'],
];

export const POLICY_KEYS = POLICIES.map(([k]) => k);

export const ROLE_TEMPLATES = {
  'Owner/Admin': POLICY_KEYS,
  Attendant: ['orders.create', 'orders.discount', 'orders.advance', 'payments.receive', 'expenses.create'],
  Operator: ['orders.advance'],
  Rider: ['orders.advance', 'payments.receive'],
};

export function effectivePolicies(rolePolicyKeys, overrides) {
  const set = new Set(rolePolicyKeys);
  // Existing Owner/Admin roles predate finance.manage; inherit it from the
  // two owner-level capabilities until their role template is next edited.
  if (set.has('users.manage') && set.has('finance.view')) set.add('finance.manage');
  if (set.has('users.manage')) set.add('branches.manage');
  for (const o of overrides) {
    if (o.effect === 'grant') set.add(o.policyKey);
    else set.delete(o.policyKey);
  }
  return [...set];
}
