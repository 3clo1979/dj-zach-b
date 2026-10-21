CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`venue` text NOT NULL,
	`type` text NOT NULL,
	`is_public` integer DEFAULT false NOT NULL,
	`facebook` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inquiries` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text NOT NULL,
	`date` text NOT NULL,
	`venue` text NOT NULL,
	`event_type` text NOT NULL,
	`guests` text NOT NULL,
	`hours` text NOT NULL,
	`services` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'New' NOT NULL,
	`created_at` text NOT NULL
);
