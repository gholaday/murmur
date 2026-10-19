CREATE TABLE `library_folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_folders_path_unique` ON `library_folders` (`path`);--> statement-breakpoint
DROP INDEX `books_folder_path_unique`;--> statement-breakpoint
ALTER TABLE `books` ADD `library_folder_id` integer REFERENCES library_folders(id) ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX `books_folder_idx` ON `books` (`library_folder_id`,`folder_path`);