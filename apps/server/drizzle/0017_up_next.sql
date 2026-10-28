CREATE TABLE `up_next` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`items` text NOT NULL,
	`idx` integer NOT NULL,
	`source_kind` text,
	`source_ref` text,
	`source_title` text,
	`original_ids` text NOT NULL,
	`shuffled` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
