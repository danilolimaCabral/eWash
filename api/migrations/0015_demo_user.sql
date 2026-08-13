-- Seed: usuário demo ativo (retry simples)
INSERT OR IGNORE INTO users (id, tenant_id, branch_id, role_id, access_scope, name, email, phone, password_hash, status)
('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000021', 'tenant', 'Lavanderia Demo', 'demo@lavatr.app', '11999990000', 'pbkdf2$100000$nus3I4EeDf6vmgSIVslXWg$eHHYGk2KVV-1CwZBQNvWJbw7t151UAsmFNc24rMQAHk', 'active');
