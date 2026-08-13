-- Seed: tenant demo "Lavanderia Demo" com branch e roles padrão (usado apenas para demonstração)
INSERT OR IGNORE INTO tenants (id, name, plan, currency, status, billing_email, code_prefix, settings)
VALUES ('00000000-0000-0000-0000-000000000001', 'Lavanderia Demo', 'pro', 'BRL', 'active', 'demo@lavatr.app', 'LV', '{}');

INSERT OR IGNORE INTO branches (id, tenant_id, name, location, active)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Filial Centro', 'Centro', 1);

INSERT OR IGNORE INTO roles (id, tenant_id, name, is_system) VALUES
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'Dono/Admin', 1),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'Atendente', 1),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', 'Operador', 1),
  ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000001', 'Entregador', 1);
