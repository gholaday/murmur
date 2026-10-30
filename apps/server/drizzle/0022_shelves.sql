CREATE TABLE `recent_sources` (
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	`last_played_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `ref_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recent_sources_played_idx` ON `recent_sources` (`user_id`,`last_played_at`);--> statement-breakpoint
ALTER TABLE `book_overrides` ADD `genres` text;--> statement-breakpoint
ALTER TABLE `movies` ADD `collection_id` integer;--> statement-breakpoint
ALTER TABLE `movies` ADD `collection_name` text;--> statement-breakpoint
ALTER TABLE `movies` ADD `release_date` text;--> statement-breakpoint
ALTER TABLE `movies` ADD `genres` text;--> statement-breakpoint
CREATE INDEX `movies_collection_idx` ON `movies` (`collection_id`);