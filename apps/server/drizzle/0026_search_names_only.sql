-- Search reads only names and people now: descriptions, episode notes and chapter titles matched
-- too much. The view, the index and its rewrite trigger lose their `body` column, the chapter
-- triggers go, and the index is rebuilt.
DROP TRIGGER `search_dirty_ai`;
--> statement-breakpoint
DROP TRIGGER `search_chapters_ai`;
--> statement-breakpoint
DROP TRIGGER `search_chapters_au`;
--> statement-breakpoint
DROP TRIGGER `search_chapters_ad`;
--> statement-breakpoint
DROP VIEW `search_source`;
--> statement-breakpoint
DROP TABLE `search_index`;
--> statement-breakpoint
CREATE VIEW `search_source` AS
SELECT 'book' AS kind, b.id AS ref, COALESCE(o.title, b.title) AS name,
  concat_ws(' ', COALESCE(o.author, b.author), COALESCE(o.narrator, b.narrator), COALESCE(o.series, b.series)) AS people
FROM books b LEFT JOIN book_overrides o ON o.book_id = b.id
UNION ALL
SELECT 'podcast', p.id, p.title, p.author FROM podcasts p
UNION ALL
SELECT 'episode', e.id, e.title, p.title FROM episodes e JOIN podcasts p ON p.id = e.podcast_id
UNION ALL
SELECT 'artist', a.id, a.name, NULL FROM artists a
UNION ALL
SELECT 'album', al.id, COALESCE(ao.title, al.title), ar.name
FROM albums al JOIN artists ar ON ar.id = al.artist_id LEFT JOIN album_overrides ao ON ao.album_id = al.id
UNION ALL
SELECT 'track', t.id, COALESCE(tov.title, t.title), concat_ws(' ', ar.name, COALESCE(ao.title, al.title))
FROM tracks t JOIN artists ar ON ar.id = t.artist_id JOIN albums al ON al.id = t.album_id
LEFT JOIN album_overrides ao ON ao.album_id = al.id LEFT JOIN track_overrides tov ON tov.track_id = t.id
UNION ALL
SELECT 'movie', m.id, m.title, NULL FROM movies m
UNION ALL
SELECT 'show', s.id, s.title, NULL FROM shows s
UNION ALL
SELECT 'video', v.id, COALESCE(te.title, v.title), s.title
FROM videos v JOIN shows s ON s.id = v.show_id
LEFT JOIN tmdb_episodes te ON te.show_id = v.show_id AND te.season = v.season AND te.episode = v.episode
WHERE v.kind = 'episode';
--> statement-breakpoint
CREATE VIRTUAL TABLE `search_index` USING fts5(name, people, content='', contentless_delete=1, tokenize='trigram remove_diacritics 1');
--> statement-breakpoint
CREATE TRIGGER `search_dirty_ai` AFTER INSERT ON `search_dirty` BEGIN
  DELETE FROM search_index WHERE rowid IN (SELECT id FROM search_rows WHERE kind = NEW.kind AND ref = NEW.ref);
  DELETE FROM search_rows WHERE kind = NEW.kind AND ref = NEW.ref;
  INSERT INTO search_rows (kind, ref, name) SELECT kind, ref, name FROM search_source WHERE kind = NEW.kind AND ref = NEW.ref;
  INSERT INTO search_index (rowid, name, people)
    SELECT r.id, s.name, s.people FROM search_source s JOIN search_rows r ON r.kind = s.kind AND r.ref = s.ref
    WHERE s.kind = NEW.kind AND s.ref = NEW.ref;
  DELETE FROM search_dirty;
END;
--> statement-breakpoint
DELETE FROM search_rows;
--> statement-breakpoint
INSERT INTO search_rows (kind, ref, name) SELECT kind, ref, name FROM search_source;
--> statement-breakpoint
INSERT INTO search_index (rowid, name, people)
SELECT r.id, s.name, s.people FROM search_source s JOIN search_rows r ON r.kind = s.kind AND r.ref = s.ref;
