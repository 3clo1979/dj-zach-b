-- Compatible with the identical schema applied manually before deployment.
-- IF NOT EXISTS preserves existing rows; it does not repair mismatched object definitions.
CREATE TABLE IF NOT EXISTS `testimonial_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`testimonial_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`actor` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`testimonial_id`) REFERENCES `testimonials`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `testimonial_audit_item_idx` ON `testimonial_audit` (`testimonial_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `testimonial_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `testimonial_rate_expiry_idx` ON `testimonial_rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `testimonials` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_key` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`event_type` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`consent_at` text NOT NULL,
	`consent_version` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`published_at` text,
	`moderated_at` text,
	`moderated_by` text,
	CONSTRAINT "testimonial_status_valid" CHECK("testimonials"."status" IN ('Pending', 'Published', 'Archived')),
	CONSTRAINT "testimonial_publication_valid" CHECK("testimonials"."status" != 'Published' OR ("testimonials"."published_at" IS NOT NULL AND "testimonials"."moderated_at" IS NOT NULL AND "testimonials"."moderated_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `testimonials_submission_key_unique` ON `testimonials` (`submission_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `testimonials_status_created_idx` ON `testimonials` (`status`,`created_at`);--> statement-breakpoint
-- Append-only history is recorded atomically, without copying private email or quote text.
CREATE TRIGGER IF NOT EXISTS `testimonial_submitted_audit`
AFTER INSERT ON `testimonials`
BEGIN
  INSERT INTO `testimonial_audit` (`testimonial_id`, `from_status`, `to_status`, `actor`, `created_at`)
  VALUES (NEW.id, NULL, NEW.status, NULL, NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `testimonial_moderated_audit`
AFTER UPDATE OF `status` ON `testimonials`
WHEN OLD.status != NEW.status
BEGIN
  INSERT INTO `testimonial_audit` (`testimonial_id`, `from_status`, `to_status`, `actor`, `created_at`)
  VALUES (NEW.id, OLD.status, NEW.status, NEW.moderated_by, NEW.moderated_at);
END;
