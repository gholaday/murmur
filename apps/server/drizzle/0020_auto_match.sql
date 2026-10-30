ALTER TABLE `albums` ADD `match_tried_at` integer;--> statement-breakpoint
ALTER TABLE `books` ADD `match_tried_at` integer;--> statement-breakpoint
ALTER TABLE `movies` ADD `poster_chosen` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `movies` ADD `backdrop_chosen` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `shows` ADD `poster_chosen` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `shows` ADD `backdrop_chosen` integer DEFAULT false NOT NULL;