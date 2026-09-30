DROP INDEX `item_version_id`;--> statement-breakpoint
CREATE UNIQUE INDEX `item_version_id` ON `item` (`version_id`);