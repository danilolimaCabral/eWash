CREATE TABLE `service_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`service_type` text NOT NULL,
	`phone` text,
	`email` text,
	`notes` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_providers_tenant` ON `service_providers` (`tenant_id`);--> statement-breakpoint
ALTER TABLE `customers` ADD `credit_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `credit_limit_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `credit_terms_days` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `expenses` ADD `provider_id` text REFERENCES service_providers(id);--> statement-breakpoint
ALTER TABLE `expenses` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `expenses` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `credit_due_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `historical` integer DEFAULT 0 NOT NULL;