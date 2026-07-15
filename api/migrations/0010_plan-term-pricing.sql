CREATE TABLE `plan_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`term_months` integer NOT NULL,
	`price_cents` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_plan_price_term` ON `plan_prices` (`plan_id`,`term_months`);--> statement-breakpoint
ALTER TABLE `tenant_subscriptions` ADD `term_months` integer DEFAULT 1 NOT NULL;