-- Before 0.5 the album playing (play_context) and the queue (queue_items) were kept apart, and
-- Up Next read them on first use. Anyone who hasn't opened it since gets them carried over here,
-- the same way: the album up to the song playing, queued songs, the rest of the album, then
-- queued episodes.
INSERT INTO `up_next` (`user_id`, `items`, `idx`, `source_kind`, `source_ref`, `source_title`, `original_ids`, `shuffled`, `updated_at`)
SELECT
  p.`user_id`,
  (SELECT json_group_array(json(entry)) FROM (
    SELECT entry FROM (
      SELECT 0 AS part, CAST(s.key AS INTEGER) AS pos, json_object('itemType', 'track', 'itemId', s.value, 'added', json('false')) AS entry
        FROM json_each(p.`track_ids`) s WHERE s.key <= p.`idx`
      UNION ALL
      SELECT 1, q.`position`, json_object('itemType', 'track', 'itemId', q.`item_id`, 'added', json('true'))
        FROM `queue_items` q WHERE q.`user_id` = p.`user_id` AND q.`item_type` = 'track'
      UNION ALL
      SELECT 2, CAST(s.key AS INTEGER), json_object('itemType', 'track', 'itemId', s.value, 'added', json('false'))
        FROM json_each(p.`track_ids`) s WHERE s.key > p.`idx`
      UNION ALL
      SELECT 3, q.`position`, json_object('itemType', 'episode', 'itemId', q.`item_id`, 'added', json('true'))
        FROM `queue_items` q WHERE q.`user_id` = p.`user_id` AND q.`item_type` = 'episode'
    ) ORDER BY part, pos
  )),
  min(p.`idx`, json_array_length(p.`track_ids`) - 1),
  p.`kind`, p.`ref_id`, p.`title`,
  coalesce(p.`original_ids`, p.`track_ids`),
  p.`shuffled`, p.`updated_at`
FROM `play_context` p
WHERE p.`user_id` NOT IN (SELECT `user_id` FROM `up_next`);
--> statement-breakpoint
-- A queue with no album: just the queued items, nothing playing from the list.
INSERT INTO `up_next` (`user_id`, `items`, `idx`, `source_kind`, `source_ref`, `source_title`, `original_ids`, `shuffled`, `updated_at`)
SELECT
  q.`user_id`,
  (SELECT json_group_array(json(entry)) FROM (
    SELECT json_object('itemType', x.`item_type`, 'itemId', x.`item_id`, 'added', json('true')) AS entry
      FROM `queue_items` x WHERE x.`user_id` = q.`user_id` ORDER BY x.`position`
  )),
  -1, NULL, NULL, NULL, '[]', 0, max(q.`added_at`)
FROM `queue_items` q
WHERE q.`user_id` NOT IN (SELECT `user_id` FROM `up_next`)
GROUP BY q.`user_id`;
--> statement-breakpoint
DROP TABLE `play_context`;--> statement-breakpoint
DROP TABLE `queue_items`;
