CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`podcast_id` text NOT NULL,
	`guid` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`published_at` integer NOT NULL,
	`duration_sec` real,
	`audio_url` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`image_url` text,
	`season` integer,
	`episode_number` integer,
	`local_path` text,
	`downloaded_at` integer,
	`first_seen_at` integer NOT NULL,
	FOREIGN KEY (`podcast_id`) REFERENCES `podcasts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_podcast_guid_idx` ON `episodes` (`podcast_id`,`guid`);--> statement-breakpoint
CREATE INDEX `episodes_podcast_published_idx` ON `episodes` (`podcast_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `podcasts` (
	`id` text PRIMARY KEY NOT NULL,
	`feed_url` text NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`description` text,
	`link` text,
	`image_url` text,
	`cover_hash` text,
	`auto_download` integer DEFAULT false NOT NULL,
	`keep_latest` integer DEFAULT 3 NOT NULL,
	`etag` text,
	`last_modified` text,
	`last_checked_at` integer,
	`last_success_at` integer,
	`last_error` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `podcasts_feed_url_unique` ON `podcasts` (`feed_url`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`user_id` integer NOT NULL,
	`podcast_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `podcast_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`podcast_id`) REFERENCES `podcasts`(`id`) ON UPDATE no action ON DELETE cascade
);
