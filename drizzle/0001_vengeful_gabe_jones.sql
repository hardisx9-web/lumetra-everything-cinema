CREATE TABLE `artwork_record` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`image_url` text NOT NULL,
	`source_url` text NOT NULL,
	`creator` text,
	`license` text NOT NULL,
	`attribution` text NOT NULL,
	`verification_status` text DEFAULT 'UNVERIFIED' NOT NULL,
	`verified_at` integer,
	`width` integer,
	`height` integer
);
--> statement-breakpoint
CREATE INDEX `artwork_entity` ON `artwork_record` (`entity_id`,`verification_status`);--> statement-breakpoint
CREATE TABLE `correction` (
	`id` text PRIMARY KEY NOT NULL,
	`page` text NOT NULL,
	`message` text NOT NULL,
	`evidence_url` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` integer NOT NULL,
	`reviewed_at` integer,
	`review_note` text
);
--> statement-breakpoint
CREATE INDEX `correction_status` ON `correction` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `editorial_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`sources` text NOT NULL,
	`confidence` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`created_at` integer NOT NULL,
	`reviewed_at` integer
);
--> statement-breakpoint
CREATE INDEX `editorial_entity` ON `editorial_revision` (`entity_id`,`status`);