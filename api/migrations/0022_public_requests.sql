-- Leva e Traz: pedidos públicos de coleta/entrega solicitados por clientes finais
CREATE TABLE IF NOT EXISTS public_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  items TEXT NOT NULL,
  notes TEXT,
  service_kind TEXT NOT NULL DEFAULT 'lavagem',
  status TEXT NOT NULL DEFAULT 'requested',
  access_code TEXT NOT NULL,
  estimated_price_cents INTEGER NOT NULL DEFAULT 0,
  internal_order_id TEXT,
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  FOREIGN KEY (branch_id) REFERENCES branches (id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_public_requests_tenant ON public_requests (tenant_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_requests_access_code ON public_requests (access_code);
--> statement-breakpoint
INSERT OR IGNORE INTO public_requests (id, tenant_id, branch_id, customer_name, phone, address, items, notes, service_kind, status, access_code, estimated_price_cents)
VALUES ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010',
  'Ana Souza', '11977774444', 'Rua das Flores, 123 - Centro', 'Lavagem por quilo, aprox. 4kg', 'Cliente pediu coleta no Leva e Traz', 'lavagem', 'requested', 'DEMO12', 3200);
