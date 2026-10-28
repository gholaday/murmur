CREATE TABLE `tmdb_episodes` (
	`show_id` text NOT NULL,
	`season` integer NOT NULL,
	`episode` integer NOT NULL,
	`title` text,
	`overview` text,
	`air_date` text,
	`still_hash` text,
	PRIMARY KEY(`show_id`, `season`, `episode`),
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `movies` ADD `tmdb_id` integer;--> statement-breakpoint
ALTER TABLE `movies` ADD `matched_at` integer;--> statement-breakpoint
ALTER TABLE `movies` ADD `details_local` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `movies` ADD `poster_tmdb` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `movies` ADD `backdrop_tmdb` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `shows` ADD `tmdb_id` integer;--> statement-breakpoint
ALTER TABLE `shows` ADD `matched_at` integer;--> statement-breakpoint
ALTER TABLE `shows` ADD `details_local` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `shows` ADD `poster_tmdb` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `shows` ADD `backdrop_tmdb` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `videos` ADD `still_from_file` integer DEFAULT false NOT NULL;