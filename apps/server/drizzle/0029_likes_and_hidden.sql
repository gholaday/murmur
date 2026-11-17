CREATE TABLE `hidden_items` (
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`hidden_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `music_likes` (
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`liked_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
