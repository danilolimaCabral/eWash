-- Brazilian locale: currency BRL, order code prefix LV, payments via Pix,
-- rename payments.mpesa_ref -> payments.pix_ref (D1: ALTER TABLE RENAME COLUMN supported).
ALTER TABLE `tenants` RENAME COLUMN `currency` TO `currency_tmp`;--> statement-breakpoint
ALTER TABLE `tenants` ADD COLUMN `currency` text DEFAULT 'BRL' NOT NULL;--> statement-breakpoint
UPDATE `tenants` SET `currency` = `currency_tmp`;--> statement-breakpoint
ALTER TABLE `tenants` DROP COLUMN `currency_tmp`;--> statement-breakpoint
ALTER TABLE `tenants` RENAME COLUMN `code_prefix` TO `code_prefix_tmp`;--> statement-breakpoint
ALTER TABLE `tenants` ADD COLUMN `code_prefix` text DEFAULT 'LV' NOT NULL;--> statement-breakpoint
UPDATE `tenants` SET `code_prefix` = `code_prefix_tmp`;--> statement-breakpoint
ALTER TABLE `tenants` DROP COLUMN `code_prefix_tmp`;--> statement-breakpoint
ALTER TABLE `plans` RENAME COLUMN `currency` TO `currency_tmp`;--> statement-breakpoint
ALTER TABLE `plans` ADD COLUMN `currency` text DEFAULT 'BRL' NOT NULL;--> statement-breakpoint
UPDATE `plans` SET `currency` = `currency_tmp`;--> statement-breakpoint
ALTER TABLE `plans` DROP COLUMN `currency_tmp`;--> statement-breakpoint
ALTER TABLE `billing_invoices` RENAME COLUMN `currency` TO `currency_tmp`;--> statement-breakpoint
ALTER TABLE `billing_invoices` ADD COLUMN `currency` text DEFAULT 'BRL' NOT NULL;--> statement-breakpoint
UPDATE `billing_invoices` SET `currency` = `currency_tmp`;--> statement-breakpoint
ALTER TABLE `billing_invoices` DROP COLUMN `currency_tmp`;--> statement-breakpoint
ALTER TABLE `payments` RENAME COLUMN `mpesa_ref` TO `pix_ref`;--> statement-breakpoint
