PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_book_overrides` (
	`book_id` text PRIMARY KEY NOT NULL,
	`provider` text,
	`provider_id` text,
	`title` text,
	`author` text,
	`narrator` text,
	`series` text,
	`series_position` real,
	`description` text,
	`year` text,
	`cover_hash` text,
	`chapters` text,
	`matched_at` integer,
	`edited_at` integer,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_book_overrides`("book_id", "provider", "provider_id", "title", "author", "narrator", "series", "series_position", "description", "year", "cover_hash", "chapters", "matched_at", "edited_at") SELECT "book_id", "provider", "provider_id", "title", "author", "narrator", "series", "series_position", "description", "year", "cover_hash", "chapters", "matched_at", NULL FROM `book_overrides`;--> statement-breakpoint
DROP TABLE `book_overrides`;--> statement-breakpoint
ALTER TABLE `__new_book_overrides` RENAME TO `book_overrides`;--> statement-breakpoint
PRAGMA foreign_keys=ON;