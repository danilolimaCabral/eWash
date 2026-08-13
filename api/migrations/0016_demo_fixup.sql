-- Fixup: garante dados completos do tenant demo (retry idempotente)
INSERT OR IGNORE INTO branches (id, tenant_id, name, location, active)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Filial Centro', 'Centro', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO roles (id, tenant_id, name, is_system) VALUES
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'Dono/Admin', 1),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'Atendente', 1),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', 'Operador', 1),
  ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000001', 'Entregador', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO roles (id, tenant_id, name, is_system) VALUES
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', 'Dono/Admin', 1),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001', 'Atendente', 1),
  ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000001', 'Operador', 1),
  ('00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000001', 'Entregador', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO users (id, tenant_id, branch_id, role_id, access_scope, name, email, phone, password_hash, status)
VALUES ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000021', 'tenant',
  'Lavanderia Demo', 'demo@lavatr.app', '11999990000', 'pbkdf2$100000$nus3I4EeDf6vmgSIVslXWg$eHHYGk2KVV-1CwZBQNvWJbw7t151UAsmFNc24rMQAHk', 'active');
--> statement-breakpoint
INSERT OR IGNORE INTO users (id, tenant_id, branch_id, role_id, access_scope, name, email, phone, password_hash, status)
VALUES ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000021', 'tenant',
  'Lavanderia Demo', 'demo@lavatr.app', '11999990000', 'pbkdf2$100000$nus3I4EeDf6vmgSIVslXWg$eHHYGk2KVV-1CwZBQNvWJbw7t151UAsmFNc24rMQAHk', 'active');
