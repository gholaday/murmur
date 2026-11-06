-- Search everywhere (server/search.ts). `search_source` says what each thing is found by: its
-- name, the people or show it belongs to, and longer text. Triggers on every table it reads put
-- the changed thing on `search_dirty`, whose own trigger rewrites its rows in the index, so no
-- write path can forget it. `search_index` is a contentless trigram FTS5 table: any part of a
-- word, ignoring case and accents. `search_rows` maps its rowids to things.
CREATE VIEW `search_source` AS
SELECT 'book' AS kind, b.id AS ref, COALESCE(o.title, b.title) AS name,
  concat_ws(' ', COALESCE(o.author, b.author), COALESCE(o.narrator, b.narrator), COALESCE(o.series, b.series)) AS people,
  concat_ws(' ', COALESCE(o.description, b.description),
    CASE WHEN o.chapters IS NOT NULL THEN (SELECT group_concat(j.value ->> 'title', ' ') FROM json_each(o.chapters) j)
    ELSE (SELECT group_concat(c.title, ' ') FROM chapters c WHERE c.book_id = b.id) END) AS body
FROM books b LEFT JOIN book_overrides o ON o.book_id = b.id
UNION ALL
SELECT 'podcast', p.id, p.title, p.author, p.description FROM podcasts p
UNION ALL
SELECT 'episode', e.id, e.title, p.title, e.description FROM episodes e JOIN podcasts p ON p.id = e.podcast_id
UNION ALL
SELECT 'artist', a.id, a.name, NULL, NULL FROM artists a
UNION ALL
SELECT 'album', al.id, COALESCE(ao.title, al.title), ar.name, NULL
FROM albums al JOIN artists ar ON ar.id = al.artist_id LEFT JOIN album_overrides ao ON ao.album_id = al.id
UNION ALL
SELECT 'track', t.id, COALESCE(tov.title, t.title), concat_ws(' ', ar.name, COALESCE(ao.title, al.title)), NULL
FROM tracks t JOIN artists ar ON ar.id = t.artist_id JOIN albums al ON al.id = t.album_id
LEFT JOIN album_overrides ao ON ao.album_id = al.id LEFT JOIN track_overrides tov ON tov.track_id = t.id
UNION ALL
SELECT 'movie', m.id, m.title, NULL, m.description FROM movies m
UNION ALL
SELECT 'show', s.id, s.title, NULL, s.description FROM shows s
UNION ALL
SELECT 'video', v.id, COALESCE(te.title, v.title), s.title, COALESCE(te.overview, v.description)
FROM videos v JOIN shows s ON s.id = v.show_id
LEFT JOIN tmdb_episodes te ON te.show_id = v.show_id AND te.season = v.season AND te.episode = v.episode
WHERE v.kind = 'episode';
--> statement-breakpoint
CREATE TABLE `search_rows` (
	`id` integer PRIMARY KEY,
	`kind` text NOT NULL,
	`ref` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_rows_ref_idx` ON `search_rows` (`kind`, `ref`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `search_index` USING fts5(name, people, body, content='', contentless_delete=1, tokenize='trigram remove_diacritics 1');
--> statement-breakpoint
CREATE TABLE `search_dirty` (`kind` text NOT NULL, `ref` text NOT NULL);
--> statement-breakpoint
CREATE TRIGGER `search_dirty_ai` AFTER INSERT ON `search_dirty` BEGIN
  DELETE FROM search_index WHERE rowid IN (SELECT id FROM search_rows WHERE kind = NEW.kind AND ref = NEW.ref);
  DELETE FROM search_rows WHERE kind = NEW.kind AND ref = NEW.ref;
  INSERT INTO search_rows (kind, ref, name) SELECT kind, ref, name FROM search_source WHERE kind = NEW.kind AND ref = NEW.ref;
  INSERT INTO search_index (rowid, name, people, body)
    SELECT r.id, s.name, s.people, s.body FROM search_source s JOIN search_rows r ON r.kind = s.kind AND r.ref = s.ref
    WHERE s.kind = NEW.kind AND s.ref = NEW.ref;
  DELETE FROM search_dirty;
END;
--> statement-breakpoint
INSERT INTO search_rows (kind, ref, name) SELECT kind, ref, name FROM search_source;
--> statement-breakpoint
INSERT INTO search_index (rowid, name, people, body)
SELECT r.id, s.name, s.people, s.body FROM search_source s JOIN search_rows r ON r.kind = s.kind AND r.ref = s.ref;
--> statement-breakpoint
CREATE TRIGGER `search_books_ai` AFTER INSERT ON `books` BEGIN INSERT INTO search_dirty VALUES ('book', NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_books_au` AFTER UPDATE OF title, author, narrator, series, description ON `books` BEGIN INSERT INTO search_dirty VALUES ('book', NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_books_ad` AFTER DELETE ON `books` BEGIN INSERT INTO search_dirty VALUES ('book', OLD.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_book_overrides_ai` AFTER INSERT ON `book_overrides` BEGIN INSERT INTO search_dirty VALUES ('book', NEW.book_id); END;
--> statement-breakpoint
CREATE TRIGGER `search_book_overrides_au` AFTER UPDATE OF title, author, narrator, series, description, chapters ON `book_overrides` BEGIN INSERT INTO search_dirty VALUES ('book', NEW.book_id); END;
--> statement-breakpoint
CREATE TRIGGER `search_book_overrides_ad` AFTER DELETE ON `book_overrides` BEGIN INSERT INTO search_dirty VALUES ('book', OLD.book_id); END;
--> statement-breakpoint
CREATE TRIGGER `search_chapters_ai` AFTER INSERT ON `chapters` BEGIN INSERT INTO search_dirty VALUES ('book', NEW.book_id); END;
--> statement-breakpoint
CREATE TRIGGER `search_chapters_au` AFTER UPDATE OF title ON `chapters` BEGIN INSERT INTO search_dirty VALUES ('book', NEW.book_id); END;
--> statement-breakpoint
CREATE TRIGGER `search_chapters_ad` AFTER DELETE ON `chapters` BEGIN INSERT INTO search_dirty VALUES ('book', OLD.book_id); END;
--> statement-breakpoint
CREATE TRIGGER `search_podcasts_ai` AFTER INSERT ON `podcasts` BEGIN INSERT INTO search_dirty VALUES ('podcast', NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_podcasts_au` AFTER UPDATE OF title, author, description ON `podcasts` BEGIN
  INSERT INTO search_dirty VALUES ('podcast', NEW.id);
  INSERT INTO search_dirty SELECT 'episode', id FROM episodes WHERE podcast_id = NEW.id AND OLD.title IS NOT NEW.title;
END;
--> statement-breakpoint
CREATE TRIGGER `search_podcasts_ad` AFTER DELETE ON `podcasts` BEGIN INSERT INTO search_dirty VALUES ('podcast', OLD.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_episodes_ai` AFTER INSERT ON `episodes` BEGIN INSERT INTO search_dirty VALUES ('episode', NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_episodes_au` AFTER UPDATE OF title, description ON `episodes` BEGIN INSERT INTO search_dirty VALUES ('episode', NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_episodes_ad` AFTER DELETE ON `episodes` BEGIN INSERT INTO search_dirty VALUES ('episode', OLD.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_artists_ai` AFTER INSERT ON `artists` BEGIN INSERT INTO search_dirty VALUES ('artist', NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_artists_au` AFTER UPDATE OF name ON `artists` BEGIN
  INSERT INTO search_dirty VALUES ('artist', NEW.id);
  INSERT INTO search_dirty SELECT 'album', id FROM albums WHERE artist_id = NEW.id;
  INSERT INTO search_dirty SELECT 'track', id FROM tracks WHERE artist_id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_artists_ad` AFTER DELETE ON `artists` BEGIN INSERT INTO search_dirty VALUES ('artist', OLD.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_albums_ai` AFTER INSERT ON `albums` BEGIN INSERT INTO search_dirty VALUES ('album', NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_albums_au` AFTER UPDATE OF title, artist_id ON `albums` BEGIN
  INSERT INTO search_dirty VALUES ('album', NEW.id);
  INSERT INTO search_dirty SELECT 'track', id FROM tracks WHERE album_id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_albums_ad` AFTER DELETE ON `albums` BEGIN INSERT INTO search_dirty VALUES ('album', OLD.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_album_overrides_ai` AFTER INSERT ON `album_overrides` BEGIN
  INSERT INTO search_dirty VALUES ('album', NEW.album_id);
  INSERT INTO search_dirty SELECT 'track', id FROM tracks WHERE album_id = NEW.album_id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_album_overrides_au` AFTER UPDATE OF title ON `album_overrides` BEGIN
  INSERT INTO search_dirty VALUES ('album', NEW.album_id);
  INSERT INTO search_dirty SELECT 'track', id FROM tracks WHERE album_id = NEW.album_id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_album_overrides_ad` AFTER DELETE ON `album_overrides` BEGIN
  INSERT INTO search_dirty VALUES ('album', OLD.album_id);
  INSERT INTO search_dirty SELECT 'track', id FROM tracks WHERE album_id = OLD.album_id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_tracks_ai` AFTER INSERT ON `tracks` BEGIN INSERT INTO search_dirty VALUES ('track', NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_tracks_au` AFTER UPDATE OF title, album_id, artist_id ON `tracks` BEGIN INSERT INTO search_dirty VALUES ('track', NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_tracks_ad` AFTER DELETE ON `tracks` BEGIN INSERT INTO search_dirty VALUES ('track', OLD.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_track_overrides_ai` AFTER INSERT ON `track_overrides` BEGIN INSERT INTO search_dirty VALUES ('track', NEW.track_id); END;
--> statement-breakpoint
CREATE TRIGGER `search_track_overrides_au` AFTER UPDATE OF title ON `track_overrides` BEGIN INSERT INTO search_dirty VALUES ('track', NEW.track_id); END;
--> statement-breakpoint
CREATE TRIGGER `search_track_overrides_ad` AFTER DELETE ON `track_overrides` BEGIN INSERT INTO search_dirty VALUES ('track', OLD.track_id); END;
--> statement-breakpoint
CREATE TRIGGER `search_movies_ai` AFTER INSERT ON `movies` BEGIN INSERT INTO search_dirty VALUES ('movie', NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_movies_au` AFTER UPDATE OF title, description ON `movies` BEGIN INSERT INTO search_dirty VALUES ('movie', NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_movies_ad` AFTER DELETE ON `movies` BEGIN INSERT INTO search_dirty VALUES ('movie', OLD.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_shows_ai` AFTER INSERT ON `shows` BEGIN INSERT INTO search_dirty VALUES ('show', NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_shows_au` AFTER UPDATE OF title, description ON `shows` BEGIN
  INSERT INTO search_dirty VALUES ('show', NEW.id);
  INSERT INTO search_dirty SELECT 'video', id FROM videos WHERE show_id = NEW.id AND OLD.title IS NOT NEW.title;
END;
--> statement-breakpoint
CREATE TRIGGER `search_shows_ad` AFTER DELETE ON `shows` BEGIN INSERT INTO search_dirty VALUES ('show', OLD.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_videos_ai` AFTER INSERT ON `videos` BEGIN INSERT INTO search_dirty VALUES ('video', NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_videos_au` AFTER UPDATE OF title, description, show_id, season, episode ON `videos` BEGIN INSERT INTO search_dirty VALUES ('video', NEW.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_videos_ad` AFTER DELETE ON `videos` BEGIN INSERT INTO search_dirty VALUES ('video', OLD.id); END;
--> statement-breakpoint
CREATE TRIGGER `search_tmdb_episodes_ai` AFTER INSERT ON `tmdb_episodes` BEGIN
  INSERT INTO search_dirty SELECT 'video', id FROM videos WHERE show_id = NEW.show_id AND season = NEW.season AND episode = NEW.episode;
END;
--> statement-breakpoint
CREATE TRIGGER `search_tmdb_episodes_au` AFTER UPDATE OF title, overview ON `tmdb_episodes` BEGIN
  INSERT INTO search_dirty SELECT 'video', id FROM videos WHERE show_id = NEW.show_id AND season = NEW.season AND episode = NEW.episode;
END;
--> statement-breakpoint
CREATE TRIGGER `search_tmdb_episodes_ad` AFTER DELETE ON `tmdb_episodes` BEGIN
  INSERT INTO search_dirty SELECT 'video', id FROM videos WHERE show_id = OLD.show_id AND season = OLD.season AND episode = OLD.episode;
END;
