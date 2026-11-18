ALTER TABLE `podcasts` ADD `podroll` text;--> statement-breakpoint
-- Read every feed in full once, so shows already followed get their podroll on the next check.
UPDATE `podcasts` SET `etag` = NULL, `last_modified` = NULL;
