ALTER TABLE `events` ADD `service_plan` text;--> statement-breakpoint
ALTER TABLE `events` ADD `contact_name` text;--> statement-breakpoint
ALTER TABLE `events` ADD `contact_email` text;--> statement-breakpoint
ALTER TABLE `events` ADD `contact_phone` text;--> statement-breakpoint
ALTER TABLE `events` ADD `revision` text DEFAULT 'legacy' NOT NULL;