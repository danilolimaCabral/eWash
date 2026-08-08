ALTER TABLE `service_providers` ADD `user_id` text REFERENCES users(id);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_provider_tenant_user` ON `service_providers` (`tenant_id`,`user_id`);