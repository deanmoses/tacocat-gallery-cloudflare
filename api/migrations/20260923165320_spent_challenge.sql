CREATE TABLE `spent_challenge` (
	`challenge` text PRIMARY KEY NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `spent_challenge_expires_at` ON `spent_challenge` (`expires_at`);