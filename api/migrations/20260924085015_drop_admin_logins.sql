-- non-additive: the passkey and invite tables come back keyed on the user table, under its name. The passkeys registered so far predate it, so the admins register again through new invites.
DROP TABLE `admin_invite`;--> statement-breakpoint
DROP TABLE `admin_passkey`;