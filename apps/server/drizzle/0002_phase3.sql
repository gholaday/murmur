CREATE TABLE `book_overrides` (
	`book_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_id` text NOT NULL,
	`title` text,
	`author` text,
	`narrator` text,
	`series` text,
	`series_position` real,
	`description` text,
	`year` text,
	`cover_hash` text,
	`chapters` text,
	`matched_at` integer NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `episode_archives` (
	`user_id` integer NOT NULL,
	`episode_id` text NOT NULL,
	`archived_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `episode_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `provider_cache` (
	`url` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `queue_items` (
	`user_id` integer NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`position` integer NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `item_type`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `queue_user_pos_idx` ON `queue_items` (`user_id`,`position`);--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `speed` real DEFAULT 1 NOT NULL;