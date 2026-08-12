// Granular policy catalog (spec §7.1). Roles are templates over these keys;
// per-user overrides (grant/deny) beat the role — an explicit deny always wins.
export const POLICIES = [
  ['orders.create', 'Criar e avaliar pedidos'],
  ['orders.discount', 'Aplicar descontos manuais (limitado)'],
  ['orders.void', 'Cancelar pedidos'],
  ['orders.advance', 'Avançar pedidos no fluxo de produção'],
  ['payments.receive', 'Receber pagamentos (dinheiro / Pix)'],
  ['payments.refund', 'Emitir reembolsos'],
  ['catalog.edit', 'Editar serviços e preços'],
  ['expenses.create', 'Registrar despesas'],
  ['finance.view', 'Ver lucro/prejuízo, relatórios e registros'],
  ['finance.manage', 'Gerenciar despesas, crédito, fornecedores e históricos'],
  ['users.manage', 'Gerenciar usuários, papéis e permissões'],
  ['branches.manage', 'Gerenciar filiais e atribuições'],
];

export const POLICY_KEYS = POLICIES.map(([k]) => k);

export const ROLE_TEMPLATES = {
  'Dono/Admin': POLICY_KEYS,
  Atendente: ['orders.create', 'orders.discount', 'orders.advance', 'payments.receive', 'expenses.create'],
  Operador: ['orders.advance'],
  Entregador: ['orders.advance', 'payments.receive'],
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
