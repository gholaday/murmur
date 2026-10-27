CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`artist_id` text NOT NULL,
	`title` text NOT NULL,
	`title_key` text NOT NULL,
	`year` text,
	`genre` text,
	`cover_hash` text,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `albums_artist_title_idx` ON `albums` (`artist_id`,`title_key`);--> statement-breakpoint
CREATE INDEX `albums_added_idx` ON `albums` (`added_at`);--> statement-breakpoint
CREATE TABLE `artists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`sort_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artists_name_key_unique` ON `artists` (`name_key`);--> statement-breakpoint
CREATE INDEX `artists_sort_idx` ON `artists` (`sort_name`);--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`album_id` text NOT NULL,
	`artist_id` text NOT NULL,
	`folder_id` integer,
	`rel_path` text NOT NULL,
	`title` text NOT NULL,
	`disc_no` integer,
	`track_no` integer,
	`duration_sec` real NOT NULL,
	`size` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`mime_type` text NOT NULL,
	`has_embedded_cover` integer DEFAULT false NOT NULL,
	`added_at` integer NOT NULL,
	`missing_since` integer,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `library_folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracks_folder_path_idx` ON `tracks` (`folder_id`,`rel_path`);--> statement-breakpoint
CREATE INDEX `tracks_album_idx` ON `tracks` (`album_id`);--> statement-breakpoint
CREATE INDEX `tracks_artist_idx` ON `tracks` (`artist_id`);--> statement-breakpoint
ALTER TABLE `library_folders` ADD `kind` text DEFAULT 'books' NOT NULL;