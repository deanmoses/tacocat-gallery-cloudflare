-- non-additive: rebuilds item for the position check and index; the columns the serving Worker reads are unchanged, and the migrations either side of this one carry the foreign-key links across the drop and remake the search index.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_item` (
	`id` integer PRIMARY KEY NOT NULL,
	`parent_path` text NOT NULL,
	`item_name` text NOT NULL,
	`item_type` text NOT NULL,
	`media_type` text,
	`title` text,
	`description` text,
	`summary` text,
	`tags` text,
	`version_id` text,
	`published` integer DEFAULT false NOT NULL,
	`width` integer,
	`height` integer,
	`duration_seconds` real,
	`thumbnail_id` integer,
	`thumbnail_crop` text,
	`position` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`thumbnail_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "item_type_check" CHECK(item_type IN ('album', 'media')),
	CONSTRAINT "item_media_type_check" CHECK((item_type = 'media') = (media_type IS NOT NULL) AND (media_type IS NULL OR media_type IN ('image', 'video'))),
	CONSTRAINT "item_path_check" CHECK(CASE item_type WHEN 'album' THEN (parent_path = '/' AND item_name GLOB '[0-9][0-9][0-9][0-9]') OR (parent_path GLOB '/[0-9][0-9][0-9][0-9]/' AND item_name GLOB '[0-9][0-9]-[0-9][0-9]' AND date(substr(parent_path, 2, 4) || '-' || item_name) IS substr(parent_path, 2, 4) || '-' || item_name) ELSE parent_path GLOB '/[0-9][0-9][0-9][0-9]/[0-9][0-9]-[0-9][0-9]/' AND date(substr(parent_path, 2, 4) || '-' || substr(parent_path, 7, 5)) IS substr(parent_path, 2, 4) || '-' || substr(parent_path, 7, 5) AND item_name GLOB '[0-9a-z]*' AND item_name NOT GLOB '*[^0-9a-z_]*' AND item_name NOT GLOB '*__*' AND item_name NOT GLOB '*_' END),
	CONSTRAINT "item_file_check" CHECK(CASE item_type WHEN 'album' THEN version_id IS NULL AND width IS NULL AND height IS NULL ELSE version_id IS NOT NULL AND version_id <> '' AND version_id NOT GLOB '*[^A-Za-z0-9._-]*' AND coalesce(width, 0) > 0 AND coalesce(height, 0) > 0 END),
	CONSTRAINT "item_duration_check" CHECK((media_type IS 'video') = (duration_seconds IS NOT NULL) AND (duration_seconds IS NULL OR duration_seconds > 0)),
	CONSTRAINT "item_caption_check" CHECK(CASE item_type WHEN 'album' THEN title IS NULL AND tags IS NULL ELSE summary IS NULL END AND (title IS NULL OR trim(title, char(32, 9, 10, 13)) <> '') AND (description IS NULL OR trim(description, char(32, 9, 10, 13)) <> '') AND (summary IS NULL OR trim(summary, char(32, 9, 10, 13)) <> '')),
	CONSTRAINT "item_tags_check" CHECK(tags IS NULL OR (json_valid(tags) AND json_type(tags) = 'array' AND json_array_length(tags) > 0)),
	CONSTRAINT "item_published_check" CHECK(published IN (0, 1) AND (item_type = 'album' OR published = 0)),
	CONSTRAINT "item_position_check" CHECK(position IS NULL OR (item_type = 'media' AND typeof(position) = 'integer' AND position >= 0)),
	CONSTRAINT "item_thumbnail_check" CHECK(CASE item_type WHEN 'album' THEN thumbnail_crop IS NULL ELSE thumbnail_id IS NULL AND (thumbnail_crop IS NULL OR (json_valid(thumbnail_crop) AND json_type(thumbnail_crop) = 'object' AND coalesce(json_type(thumbnail_crop, '$.x'), '') IN ('integer', 'real') AND coalesce(json_type(thumbnail_crop, '$.y'), '') IN ('integer', 'real') AND coalesce(json_type(thumbnail_crop, '$.width'), '') IN ('integer', 'real') AND coalesce(json_type(thumbnail_crop, '$.height'), '') IN ('integer', 'real') AND json_extract(thumbnail_crop, '$.x') >= 0 AND json_extract(thumbnail_crop, '$.y') >= 0 AND json_extract(thumbnail_crop, '$.width') > 0 AND json_extract(thumbnail_crop, '$.height') > 0 AND json_extract(thumbnail_crop, '$.x') + json_extract(thumbnail_crop, '$.width') <= coalesce(width, 0) AND json_extract(thumbnail_crop, '$.y') + json_extract(thumbnail_crop, '$.height') <= coalesce(height, 0))) END),
	CONSTRAINT "item_created_at_format" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
	CONSTRAINT "item_updated_at_format" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
	CONSTRAINT "item_updated_after_created" CHECK(updated_at >= created_at)
);
--> statement-breakpoint
INSERT INTO `__new_item`("id", "parent_path", "item_name", "item_type", "media_type", "title", "description", "summary", "tags", "version_id", "published", "width", "height", "duration_seconds", "thumbnail_id", "thumbnail_crop", "position", "created_at", "updated_at") SELECT "id", "parent_path", "item_name", "item_type", "media_type", "title", "description", "summary", "tags", "version_id", "published", "width", "height", "duration_seconds", "thumbnail_id", "thumbnail_crop", "position", "created_at", "updated_at" FROM `item`;--> statement-breakpoint
DROP TABLE `item`;--> statement-breakpoint
ALTER TABLE `__new_item` RENAME TO `item`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `item_version_id` ON `item` (`version_id`);--> statement-breakpoint
CREATE INDEX `item_thumbnail_id` ON `item` (`thumbnail_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `item_album_position` ON `item` (`parent_path`,`position`) WHERE position IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `item_parent_path_item_name_unique` ON `item` (`parent_path`,`item_name`);