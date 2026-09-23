-- non-additive: drizzle-kit's rebuild for the change the migration before it made; see that one.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_item` (
	`id` integer PRIMARY KEY NOT NULL,
	`parent_path` text NOT NULL,
	`item_name` text NOT NULL,
	`item_type` text NOT NULL,
	`media_type` text,
	`title` text,
	`description` text,
	`tags` text,
	`version_id` text,
	`published` integer DEFAULT false NOT NULL,
	`updated_on` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`width` integer,
	`height` integer,
	`duration_seconds` real,
	`thumbnail_id` integer,
	`thumbnail_crop` text,
	CONSTRAINT "item_type_check" CHECK("__new_item"."item_type" IN ('album', 'media')),
	CONSTRAINT "media_type_check" CHECK(("__new_item"."item_type" = 'media') = ("__new_item"."media_type" IS NOT NULL) AND ("__new_item"."media_type" IS NULL OR "__new_item"."media_type" IN ('image', 'video')))
);
--> statement-breakpoint
INSERT INTO `__new_item`("id", "parent_path", "item_name", "item_type", "media_type", "title", "description", "tags", "version_id", "published", "updated_on", "width", "height", "duration_seconds", "thumbnail_id", "thumbnail_crop") SELECT "id", "parent_path", "item_name", "item_type", "media_type", "title", "description", "tags", "version_id", "published", "updated_on", "width", "height", "duration_seconds", "thumbnail_id", "thumbnail_crop" FROM `item`;--> statement-breakpoint
DROP TABLE `item`;--> statement-breakpoint
ALTER TABLE `__new_item` RENAME TO `item`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `item_parent_path_item_name_unique` ON `item` (`parent_path`,`item_name`);