-- Episodes saved before feeds' audio types were cleaned up still carry whatever the feed said
-- ("Audio/MP4; codecs=mp4a", "text/html"). Clean them the way feed.ts's audioMimeType does now:
-- the bare type in lower case if it's an audio type Murmur knows, else none (served as MP3).
UPDATE `episodes` SET `mime_type` = (
  SELECT CASE WHEN t IN ('audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/aacp', 'audio/ogg',
                         'audio/opus', 'audio/flac', 'audio/x-flac', 'audio/wav', 'audio/x-wav', 'audio/webm') THEN t END
  FROM (SELECT lower(trim(CASE WHEN instr(`mime_type`, ';') > 0 THEN substr(`mime_type`, 1, instr(`mime_type`, ';') - 1) ELSE `mime_type` END)) AS t)
)
WHERE `mime_type` IS NOT NULL;
--> statement-breakpoint
-- A cached file took its episode's type, falling back to MP3.
UPDATE `episode_files` SET `mime_type` = coalesce((
  SELECT CASE WHEN t IN ('audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/aacp', 'audio/ogg',
                         'audio/opus', 'audio/flac', 'audio/x-flac', 'audio/wav', 'audio/x-wav', 'audio/webm') THEN t END
  FROM (SELECT lower(trim(CASE WHEN instr(`mime_type`, ';') > 0 THEN substr(`mime_type`, 1, instr(`mime_type`, ';') - 1) ELSE `mime_type` END)) AS t)
), 'audio/mpeg');
