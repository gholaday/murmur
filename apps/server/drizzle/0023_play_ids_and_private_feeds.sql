CREATE TABLE `track_play_ids` (
	`user_id` integer NOT NULL,
	`play_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `play_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `track_play_ids_created_idx` ON `track_play_ids` (`created_at`);--> statement-breakpoint
ALTER TABLE `podcasts` ADD `private_feed` integer DEFAULT false NOT NULL;