CREATE TABLE `play_next` (
	`user_id` integer NOT NULL,
	`book_id` text NOT NULL,
	`position` integer NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `book_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Books leave the Up Next queue: ones already queued move onto Play next, in queue order.
INSERT INTO `play_next` (`user_id`, `book_id`, `position`, `added_at`)
SELECT `user_id`, `item_id`, ROW_NUMBER() OVER (PARTITION BY `user_id` ORDER BY `position`) - 1, `added_at`
FROM `queue_items` WHERE `item_type` = 'book';
--> statement-breakpoint
DELETE FROM `queue_items` WHERE `item_type` = 'book';
