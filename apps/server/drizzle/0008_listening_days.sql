CREATE TABLE `listening_days` (
	`user_id` integer NOT NULL,
	`client_id` text NOT NULL,
	`day` text NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`listened_sec` real NOT NULL,
	`content_sec` real NOT NULL,
	PRIMARY KEY(`user_id`, `client_id`, `day`, `item_type`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `listening_days_user_day_idx` ON `listening_days` (`user_id`,`day`);