CREATE TABLE `evidence` (
	`work_id` text,
	`payload` text
);
--> statement-breakpoint
CREATE INDEX `evidence_work` ON `evidence` (`work_id`);--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `publication_import` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `source` (
	`source_id` text PRIMARY KEY NOT NULL,
	`work_id` text,
	`watch_state` text,
	`checked_ms` integer,
	`expires_ms` integer,
	`payload` text
);
--> statement-breakpoint
CREATE INDEX `source_work` ON `source` (`work_id`,`checked_ms`);--> statement-breakpoint
CREATE TABLE `work` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`original_title` text,
	`alternate_titles` text,
	`year` integer,
	`director` text,
	`countries` text,
	`runtime` real,
	`verification_level` text,
	`coverage_tier` integer
);
--> statement-breakpoint
CREATE INDEX `title_order` ON `work` (`title`,`id`);--> statement-breakpoint
CREATE INDEX `release_year` ON `work` (`year`);
--> statement-breakpoint
CREATE UNIQUE INDEX evidence_unique ON evidence(work_id,payload);
--> statement-breakpoint
CREATE VIRTUAL TABLE search USING fts5(id UNINDEXED,title,original_title,aliases,director);
