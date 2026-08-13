-- LavTr: ativa a conta demo (lavanderia de demonstração para vendas)
-- Usuário demo@lavatr.app passa para 'active' e seu tenant fica ativo.
UPDATE users SET status = 'active' WHERE email = 'demo@lavatr.app';
UPDATE tenants SET status = 'active' WHERE id = (SELECT tenant_id FROM users WHERE email = 'demo@lavatr.app' LIMIT 1);
