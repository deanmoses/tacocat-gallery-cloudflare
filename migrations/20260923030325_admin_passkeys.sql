CREATE TABLE `admin_invite` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`admin_name` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE TABLE `admin_passkey` (
	`credential_id` text PRIMARY KEY NOT NULL,
	`admin_name` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_used_at` text
);
