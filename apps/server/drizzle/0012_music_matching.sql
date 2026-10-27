CREATE TABLE `album_overrides` (
	`album_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_id` text NOT NULL,
	`title` text,
	`year` text,
	`genre` text,
	`cover_hash` text,
	`matched_at` integer NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `artist_photos` (
	`name_key` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`photo_hash` text,
	`provider_id` text,
	`checked_at` integer NOT NULL
);
