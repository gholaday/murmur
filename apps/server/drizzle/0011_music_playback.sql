CREATE TABLE `play_context` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text,
	`title` text NOT NULL,
	`track_ids` text NOT NULL,
	`idx` integer NOT NULL,
	`shuffled` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `track_plays` (
	`user_id` integer NOT NULL,
	`track_id` text NOT NULL,
	`count` integer NOT NULL,
	`last_played_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `track_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
