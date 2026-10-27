CREATE TABLE `playlist_tracks` (
	`playlist_id` text NOT NULL,
	`track_id` text NOT NULL,
	`position` integer NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`playlist_id`, `track_id`),
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `playlist_tracks_order_idx` ON `playlist_tracks` (`playlist_id`,`position`);--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `playlists_user_idx` ON `playlists` (`user_id`);--> statement-breakpoint
CREATE TABLE `track_overrides` (
	`track_id` text PRIMARY KEY NOT NULL,
	`title` text,
	`disc_no` integer,
	`track_no` integer,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
