CREATE TABLE `studio_photo` (
	`id` integer PRIMARY KEY NOT NULL,
	`bytes` blob NOT NULL,
	`content_type` text NOT NULL,
	`version` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "studio_photo_singleton" CHECK("studio_photo"."id" = 1),
	CONSTRAINT "studio_photo_size" CHECK(length("studio_photo"."bytes") BETWEEN 1 AND 1000000),
	CONSTRAINT "studio_photo_type" CHECK("studio_photo"."content_type" IN ('image/jpeg', 'image/png'))
);
