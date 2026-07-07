ALTER TABLE `users` ADD `access_scope` text DEFAULT 'branch' NOT NULL;
--> statement-breakpoint
UPDATE `users`
SET `access_scope` = 'tenant'
WHERE `role_id` IN (SELECT `id` FROM `roles` WHERE `name` = 'Owner/Admin');
