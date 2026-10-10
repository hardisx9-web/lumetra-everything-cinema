CREATE TABLE `work_metadata` (
	`work_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `work_id` text;--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `original_url` text;--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `alt` text;--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `license_verified` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `artwork_type` text DEFAULT 'POSTER' NOT NULL;--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `copyright_holder` text;--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `license_url` text;--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `match_confidence` real;--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `match_method` text;--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `review_status` text DEFAULT 'PENDING_REVIEW' NOT NULL;--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `health_status` text DEFAULT 'UNTESTED' NOT NULL;--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `health_checked_at` integer;--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `image_sha256` text;--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `variants` text;--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `artwork_language` text;--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `territory` text;--> statement-breakpoint
ALTER TABLE `artwork_record` ADD `is_primary` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `artwork_work_review` ON `artwork_record` (`work_id`,`review_status`,`health_status`);