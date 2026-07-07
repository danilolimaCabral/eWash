CREATE INDEX `idx_notif_order` ON `notifications` (`order_id`);--> statement-breakpoint
CREATE INDEX `idx_addons_service` ON `order_item_addons` (`addon_service_id`);--> statement-breakpoint
CREATE INDEX `idx_items_service` ON `order_items` (`service_id`);