CREATE TABLE `book_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` text NOT NULL,
	`idx` integer NOT NULL,
	`rel_path` text NOT NULL,
	`size` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`duration_sec` real NOT NULL,
	`start_sec` real NOT NULL,
	`mime_type` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `book_files_book_idx` ON `book_files` (`book_id`,`idx`);--> statement-breakpoint
CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_path` text NOT NULL,
	`content_key` text NOT NULL,
	`scan_signature` text NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`narrator` text,
	`series` text,
	`series_position` real,
	`description` text,
	`year` text,
	`asin` text,
	`duration_sec` real DEFAULT 0 NOT NULL,
	`cover_hash` text,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`missing_since` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `books_folder_path_unique` ON `books` (`folder_path`);--> statement-breakpoint
CREATE INDEX `books_content_key_idx` ON `books` (`content_key`);--> statement-breakpoint
CREATE INDEX `books_added_idx` ON `books` (`added_at`);--> statement-breakpoint
CREATE INDEX `books_author_idx` ON `books` (`author`);--> statement-breakpoint
CREATE INDEX `books_series_idx` ON `books` (`series`);--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` text NOT NULL,
	`idx` integer NOT NULL,
	`title` text NOT NULL,
	`start_sec` real NOT NULL,
	`end_sec` real NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapters_book_idx` ON `chapters` (`book_id`,`idx`);--> statement-breakpoint
CREATE TABLE `progress` (
	`user_id` integer NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`position_sec` real NOT NULL,
	`duration_sec` real NOT NULL,
	`finished` integer DEFAULT false NOT NULL,
	`speed` real DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `item_type`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `progress_user_updated_idx` ON `progress` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`device_name` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);