CREATE TABLE `bookmarks` (
	`user_id` integer NOT NULL,
	`id` text NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`position_sec` real NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bookmarks_item_idx` ON `bookmarks` (`user_id`,`item_type`,`item_id`);