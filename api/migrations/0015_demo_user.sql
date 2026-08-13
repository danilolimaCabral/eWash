-- Seed: usuário demo ativo (retry simples)
INSERT OR IGNORE INTO users (id, tenant_id, branch_id, role_id, access_scope, name, email, phone, password_hash, status)
VALUES ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000021', 'tenant',
  'Lavanderia Demo', 'demo@lavatr.app', '11999990000', '$HASH', 'active');
