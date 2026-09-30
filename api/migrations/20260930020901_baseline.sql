CREATE TABLE `invite` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`username`) REFERENCES `user`(`username`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invite_token_hash_format" CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "invite_expires_at_format" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS expires_at),
	CONSTRAINT "invite_used_at_format" CHECK(used_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', used_at) IS used_at),
	CONSTRAINT "invite_created_at_format" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
	CONSTRAINT "invite_updated_at_format" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
	CONSTRAINT "invite_updated_after_created" CHECK(updated_at >= created_at)
);
--> statement-breakpoint
CREATE TABLE `item` (
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
	CONSTRAINT "item_file_check" CHECK(CASE item_type WHEN 'album' THEN version_id IS NULL AND width IS NULL AND height IS NULL ELSE version_id IS NOT NULL AND length(version_id) = 26 AND version_id GLOB '[0-7]*' AND version_id NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*' AND coalesce(width, 0) > 0 AND coalesce(height, 0) > 0 END),
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
CREATE INDEX `item_version_id` ON `item` (`version_id`);--> statement-breakpoint
CREATE INDEX `item_thumbnail_id` ON `item` (`thumbnail_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `item_album_position` ON `item` (`parent_path`,`position`) WHERE position IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `item_parent_path_item_name_unique` ON `item` (`parent_path`,`item_name`);--> statement-breakpoint
CREATE TABLE `passkey` (
	`credential_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`last_used_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`username`) REFERENCES `user`(`username`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "passkey_credential_id_check" CHECK(credential_id <> ''),
	CONSTRAINT "passkey_public_key_check" CHECK(public_key <> ''),
	CONSTRAINT "passkey_counter_check" CHECK(counter >= 0),
	CONSTRAINT "passkey_last_used_at_format" CHECK(last_used_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', last_used_at) IS last_used_at),
	CONSTRAINT "passkey_created_at_format" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
	CONSTRAINT "passkey_updated_at_format" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
	CONSTRAINT "passkey_updated_after_created" CHECK(updated_at >= created_at)
);
--> statement-breakpoint
CREATE TABLE `spent_challenge` (
	`challenge` text PRIMARY KEY NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "spent_challenge_expires_at_format" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS expires_at),
	CONSTRAINT "spent_challenge_created_at_format" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
	CONSTRAINT "spent_challenge_updated_at_format" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
	CONSTRAINT "spent_challenge_updated_after_created" CHECK(updated_at >= created_at)
);
--> statement-breakpoint
CREATE INDEX `spent_challenge_expires_at` ON `spent_challenge` (`expires_at`);--> statement-breakpoint
CREATE TABLE `upload` (
	`version_id` text PRIMARY KEY NOT NULL,
	`parent_path` text NOT NULL,
	`item_name` text NOT NULL,
	`album_id` integer,
	`replacement` integer DEFAULT false NOT NULL,
	`target_id` integer,
	`username` text NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`username`) REFERENCES `user`(`username`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "upload_version_id_format" CHECK(version_id IS NOT NULL AND length(version_id) = 26 AND version_id GLOB '[0-7]*' AND version_id NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	CONSTRAINT "upload_path_check" CHECK(parent_path GLOB '/[0-9][0-9][0-9][0-9]/[0-9][0-9]-[0-9][0-9]/' AND date(substr(parent_path, 2, 4) || '-' || substr(parent_path, 7, 5)) IS substr(parent_path, 2, 4) || '-' || substr(parent_path, 7, 5) AND item_name GLOB '[0-9a-z]*' AND item_name NOT GLOB '*[^0-9a-z_]*' AND item_name NOT GLOB '*__*' AND item_name NOT GLOB '*_'),
	CONSTRAINT "upload_target_check" CHECK(replacement IN (0, 1) AND (replacement = 1 OR target_id IS NULL)),
	CONSTRAINT "upload_completed_at_format" CHECK(completed_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', completed_at) IS completed_at),
	CONSTRAINT "upload_created_at_format" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
	CONSTRAINT "upload_updated_at_format" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
	CONSTRAINT "upload_updated_after_created" CHECK(updated_at >= created_at)
);
--> statement-breakpoint
CREATE INDEX `upload_album_id` ON `upload` (`album_id`);--> statement-breakpoint
CREATE INDEX `upload_target_id` ON `upload` (`target_id`);--> statement-breakpoint
CREATE TABLE `upload_error` (
	`path` text PRIMARY KEY NOT NULL,
	`message` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "upload_error_path_check" CHECK(path IS NOT NULL AND substr(path, 1, 12) GLOB '/[0-9][0-9][0-9][0-9]/[0-9][0-9]-[0-9][0-9]/' AND date(substr(substr(path, 1, 12), 2, 4) || '-' || substr(substr(path, 1, 12), 7, 5)) IS substr(substr(path, 1, 12), 2, 4) || '-' || substr(substr(path, 1, 12), 7, 5) AND substr(path, 13) GLOB '[0-9a-z]*' AND substr(path, 13) NOT GLOB '*[^0-9a-z_]*' AND substr(path, 13) NOT GLOB '*__*' AND substr(path, 13) NOT GLOB '*_'),
	CONSTRAINT "upload_error_message_check" CHECK(trim(message, char(32, 9, 10, 13)) <> ''),
	CONSTRAINT "upload_error_created_at_format" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
	CONSTRAINT "upload_error_updated_at_format" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
	CONSTRAINT "upload_error_updated_after_created" CHECK(updated_at >= created_at)
);
--> statement-breakpoint
CREATE TABLE `user` (
	`username` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "user_username_format" CHECK(username GLOB '[a-z]*' AND username NOT GLOB '*[^a-z0-9_]*'),
	CONSTRAINT "user_created_at_format" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS created_at),
	CONSTRAINT "user_updated_at_format" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS updated_at),
	CONSTRAINT "user_updated_after_created" CHECK(updated_at >= created_at)
);
