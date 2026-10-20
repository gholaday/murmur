CREATE TABLE `ad_scans` (
	`file_id` integer PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`pieces_done` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`lease_until` integer,
	`not_before` integer,
	`wanted_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `episode_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ad_scans_status_idx` ON `ad_scans` (`status`);--> statement-breakpoint
CREATE TABLE `episode_ads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`start_sec` real NOT NULL,
	`end_sec` real NOT NULL,
	`kind` text NOT NULL,
	`advertiser` text,
	`first_words` text,
	FOREIGN KEY (`file_id`) REFERENCES `episode_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `episode_ads_file_idx` ON `episode_ads` (`file_id`);--> statement-breakpoint
CREATE TABLE `episode_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`episode_id` text NOT NULL,
	`rel_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`ready_at` integer,
	`last_played_at` integer,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episode_files_episode_id_unique` ON `episode_files` (`episode_id`);--> statement-breakpoint
CREATE INDEX `episode_files_status_idx` ON `episode_files` (`status`);--> statement-breakpoint
CREATE TABLE `server_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
