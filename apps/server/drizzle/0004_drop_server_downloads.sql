ALTER TABLE `episodes` DROP COLUMN `local_path`;--> statement-breakpoint
ALTER TABLE `episodes` DROP COLUMN `downloaded_at`;--> statement-breakpoint
ALTER TABLE `podcasts` DROP COLUMN `auto_download`;--> statement-breakpoint
ALTER TABLE `podcasts` DROP COLUMN `keep_latest`;