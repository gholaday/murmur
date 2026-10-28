CREATE TABLE `movies` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` integer,
	`rel_path` text NOT NULL,
	`title` text NOT NULL,
	`sort_title` text NOT NULL,
	`year` text,
	`description` text,
	`poster_hash` text,
	`backdrop_hash` text,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `library_folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `movies_folder_path_idx` ON `movies` (`folder_id`,`rel_path`);--> statement-breakpoint
CREATE INDEX `movies_sort_idx` ON `movies` (`sort_title`);--> statement-breakpoint
CREATE TABLE `shows` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` integer,
	`rel_path` text NOT NULL,
	`title` text NOT NULL,
	`sort_title` text NOT NULL,
	`year` text,
	`description` text,
	`poster_hash` text,
	`backdrop_hash` text,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `library_folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shows_folder_path_idx` ON `shows` (`folder_id`,`rel_path`);--> statement-breakpoint
CREATE INDEX `shows_sort_idx` ON `shows` (`sort_title`);--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`folder_id` integer,
	`rel_path` text NOT NULL,
	`movie_id` text,
	`edition` text,
	`show_id` text,
	`season` integer,
	`episode` integer,
	`title` text NOT NULL,
	`sort_title` text NOT NULL,
	`year` text,
	`description` text,
	`duration_sec` real NOT NULL,
	`size` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`container` text NOT NULL,
	`video_codec` text,
	`width` integer,
	`height` integer,
	`hdr` text,
	`audio_tracks` text DEFAULT '[]' NOT NULL,
	`subtitle_tracks` text DEFAULT '[]' NOT NULL,
	`still_hash` text,
	`added_at` integer NOT NULL,
	`missing_since` integer,
	FOREIGN KEY (`folder_id`) REFERENCES `library_folders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `videos_folder_path_idx` ON `videos` (`folder_id`,`rel_path`);--> statement-breakpoint
CREATE INDEX `videos_show_idx` ON `videos` (`show_id`,`season`,`episode`);--> statement-breakpoint
CREATE INDEX `videos_movie_idx` ON `videos` (`movie_id`);--> statement-breakpoint
CREATE INDEX `videos_kind_added_idx` ON `videos` (`kind`,`added_at`);