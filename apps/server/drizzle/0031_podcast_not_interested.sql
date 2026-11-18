CREATE TABLE `podcast_not_interested` (
	`user_id` integer NOT NULL,
	`feed_url` text NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `feed_url`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
