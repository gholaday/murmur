import type {
  AlbumDetail,
  AlbumMatchProvider,
  AlbumSort,
  AlbumSummary,
  ArtistDetail,
  ArtistSummary,
  LikedMusicDto,
  MusicLikeChange,
  MusicSummaryDto,
  TrackDto,
} from "@murmur/shared";
import { NEW_ALBUM_DAYS } from "@murmur/shared";
import type { AppContext } from "../context";
import { coverColors } from "../library/covers";

// Read side of music: everything the Music section, album and artist pages show. Songs whose
// file has gone missing are left out, and so are albums left with none. Everyone sees all the
// music; likes (music_likes) mark songs and albums, and hidden ones are filtered by the caller.

interface AlbumRow {
  id: string;
  title: string;
  artist_id: string;
  artist: string;
  year: string | null;
  genre: string | null;
  cover_hash: string | null;
  added_at: number;
  track_count: number;
  duration: number;
  liked: number;
  matched: number;
}

interface TrackRow {
  id: string;
  title: string;
  album_id: string;
  album: string;
  artist_id: string;
  artist: string;
  disc_no: number | null;
  track_no: number | null;
  duration_sec: number;
  mime_type: string;
  cover_hash: string | null;
  liked: number;
}

/** @user liked this song or album. */
const LIKED = (kind: "track" | "album", id: string) =>
  `EXISTS (SELECT 1 FROM music_likes ml WHERE ml.user_id = @user AND ml.kind = '${kind}' AND ml.item_id = ${id})`;

/** Albums as shown: what Match chose wins over the tags. Sorting keeps the tags' title key. */
const ALBUMS = `(
  SELECT al.id, al.artist_id, COALESCE(o.title, al.title) AS title, al.title_key, COALESCE(o.year, al.year) AS year,
         COALESCE(o.genre, al.genre) AS genre, COALESCE(o.cover_hash, al.cover_hash) AS cover_hash, al.added_at,
         o.album_id IS NOT NULL AS matched, o.provider, o.provider_id, o.matched_at
  FROM albums al LEFT JOIN album_overrides o ON o.album_id = al.id)`;

const ALBUM_SELECT = `
  SELECT a.id, a.title, a.artist_id, ar.name AS artist, a.year, a.genre, a.cover_hash, a.added_at, a.matched,
         COUNT(t.id) AS track_count, SUM(t.duration_sec) AS duration, ${LIKED("album", "a.id")} AS liked
  FROM ${ALBUMS} a
  JOIN artists ar ON ar.id = a.artist_id
  JOIN tracks t ON t.album_id = a.id AND t.missing_since IS NULL`;

const ALBUM_ORDER: Record<AlbumSort, string> = {
  added: "a.added_at DESC, a.title_key",
  name: "a.title_key",
  artist: "ar.sort_name, a.year, a.title_key",
  year: "a.year IS NULL, a.year DESC, a.title_key",
};

/** Songs as shown: titles and numbers from an album's Match win over the tags. */
const TRACKS = `(
  SELECT t.id, t.album_id, t.artist_id, COALESCE(o.title, t.title) AS title, COALESCE(o.disc_no, t.disc_no) AS disc_no,
         COALESCE(o.track_no, t.track_no) AS track_no, t.duration_sec, t.mime_type, t.missing_since
  FROM tracks t LEFT JOIN track_overrides o ON o.track_id = t.id)`;

const TRACK_SELECT = `
  SELECT t.id, t.title, t.album_id, al.title AS album, t.artist_id, ar.name AS artist,
         t.disc_no, t.track_no, t.duration_sec, t.mime_type, al.cover_hash, ${LIKED("track", "t.id")} AS liked
  FROM ${TRACKS} t
  JOIN ${ALBUMS} al ON al.id = t.album_id
  JOIN artists ar ON ar.id = t.artist_id
  WHERE t.missing_since IS NULL`;

/** Disc, then track number, then title: how an album plays. */
const PLAY_ORDER = "COALESCE(t.disc_no, 1), t.track_no IS NULL, t.track_no, t.title COLLATE NOCASE";
/** Song search and lists stop here; a bigger library is browsed by album. */
const MAX_TRACKS = 5000;

async function toAlbums(rows: AlbumRow[]): Promise<AlbumSummary[]> {
  const colors = await coverColors(rows.map((r) => r.cover_hash));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    artistId: r.artist_id,
    artist: r.artist,
    year: r.year,
    genre: r.genre,
    coverHash: r.cover_hash,
    coverColor: r.cover_hash ? (colors.get(r.cover_hash) ?? null) : null,
    trackCount: r.track_count,
    durationSec: r.duration ?? 0,
    addedAt: r.added_at,
    songsInMusic: r.track_count,
    matched: r.matched === 1,
    liked: r.liked === 1,
  }));
}

const toTrack = (r: TrackRow): TrackDto => ({
  id: r.id,
  title: r.title,
  albumId: r.album_id,
  album: r.album,
  artistId: r.artist_id,
  artist: r.artist,
  discNo: r.disc_no,
  trackNo: r.track_no,
  durationSec: r.duration_sec,
  mimeType: r.mime_type,
  coverHash: r.cover_hash,
  inMusic: true,
  liked: r.liked === 1,
});

export function musicSummary(ctx: AppContext): MusicSummaryDto {
  const all = ctx.sqlite
    .prepare(
      `SELECT COUNT(*) AS tracks, COUNT(DISTINCT t.album_id) AS albums, COUNT(DISTINCT al.artist_id) AS artists,
              COUNT(DISTINCT CASE WHEN al.added_at > @since THEN al.id END) AS newAlbums
       FROM tracks t JOIN albums al ON al.id = t.album_id WHERE t.missing_since IS NULL`,
    )
    .get({ since: Date.now() - NEW_ALBUM_DAYS * 86_400_000 }) as { tracks: number; albums: number; artists: number; newAlbums: number };
  // `mine` is for older apps, which show "Pick the music you want" when it's empty.
  return { enabled: ctx.music.folders().length > 0, ...all, mine: { albums: all.albums, tracks: all.tracks } };
}

/** You > Library's album counts for admins: every album with songs here, and those not matched. */
export function albumCounts(ctx: AppContext): { albums: number; unmatched: number } {
  return ctx.sqlite
    .prepare(
      `SELECT COUNT(*) AS albums, COUNT(*) FILTER (WHERE NOT a.matched) AS unmatched
       FROM ${ALBUMS} a WHERE EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = a.id AND t.missing_since IS NULL)`,
    )
    .get() as { albums: number; unmatched: number };
}

/** Every album. `userId` null (Match all) leaves out likes. */
export function listAlbums(ctx: AppContext, userId: number | null, sort: AlbumSort): Promise<AlbumSummary[]> {
  return toAlbums(ctx.sqlite.prepare(`${ALBUM_SELECT} GROUP BY a.id ORDER BY ${ALBUM_ORDER[sort]}`).all({ user: userId }) as AlbumRow[]);
}

/** These albums, by id, in no particular order; ones gone from the server are left out. */
export function albumsByIds(ctx: AppContext, userId: number, ids: string[]): Promise<AlbumSummary[]> {
  if (!ids.length) return Promise.resolve([]);
  return toAlbums(
    ctx.sqlite
      .prepare(`${ALBUM_SELECT} WHERE a.id IN (SELECT value FROM json_each(@ids)) GROUP BY a.id`)
      .all({ user: userId, ids: JSON.stringify(ids) }) as AlbumRow[],
  );
}

/** Albums found since `since`, newest first. */
export function listNewAlbums(ctx: AppContext, userId: number, since: number): Promise<AlbumSummary[]> {
  return toAlbums(
    ctx.sqlite
      .prepare(`${ALBUM_SELECT} WHERE a.added_at > @since GROUP BY a.id ORDER BY ${ALBUM_ORDER.added}`)
      .all({ user: userId, since }) as AlbumRow[],
  );
}

/** An album with its songs. `userId` null (Match) leaves out likes. */
export async function getAlbum(ctx: AppContext, userId: number | null, id: string): Promise<AlbumDetail | null> {
  const [album] = await toAlbums(ctx.sqlite.prepare(`${ALBUM_SELECT} WHERE a.id = @id GROUP BY a.id`).all({ user: userId, id }) as AlbumRow[]);
  if (!album) return null;
  const tracks = ctx.sqlite.prepare(`${TRACK_SELECT} AND t.album_id = @id ORDER BY ${PLAY_ORDER}`).all({ user: userId, id }) as TrackRow[];
  const match = ctx.sqlite.prepare("SELECT provider, provider_id, matched_at FROM album_overrides WHERE album_id = ?").get(id) as
    | { provider: AlbumMatchProvider; provider_id: string; matched_at: number }
    | undefined;
  return {
    ...album,
    tracks: tracks.map(toTrack),
    match: match ? { provider: match.provider, providerId: match.provider_id, matchedAt: match.matched_at } : null,
  };
}

export function getAlbumCoverHash(ctx: AppContext, id: string): string | null {
  return (ctx.sqlite.prepare(`SELECT cover_hash FROM ${ALBUMS} WHERE id = ?`).get(id) as { cover_hash: string | null } | undefined)?.cover_hash ?? null;
}

export function getArtistPhotoHash(ctx: AppContext, id: string): string | null {
  const row = ctx.sqlite
    .prepare("SELECT p.photo_hash FROM artists ar JOIN artist_photos p ON p.name_key = ar.name_key WHERE ar.id = ?")
    .get(id) as { photo_hash: string | null } | undefined;
  return row?.photo_hash ?? null;
}

interface ArtistRow {
  id: string;
  name: string;
  album_count: number;
  track_count: number;
  photo_hash: string | null;
  cover_album_id: string | null;
  cover_hash: string | null;
}

/** An artist with their album and song counts. */
const ARTIST_SELECT = `
  SELECT ar.id, ar.name,
    (SELECT COUNT(DISTINCT t.album_id) FROM tracks t JOIN albums a ON a.id = t.album_id
     WHERE a.artist_id = ar.id AND t.missing_since IS NULL) AS album_count,
    -- Their own songs, plus others' songs on their albums; two halves so each uses an index.
    (SELECT COUNT(*) FROM tracks t WHERE t.artist_id = ar.id AND t.missing_since IS NULL)
    + (SELECT COUNT(*) FROM tracks t JOIN albums a ON a.id = t.album_id
       WHERE a.artist_id = ar.id AND t.artist_id != ar.id AND t.missing_since IS NULL) AS track_count,
    p.photo_hash, c.id AS cover_album_id, c.cover_hash
  FROM artists ar
  LEFT JOIN artist_photos p ON p.name_key = ar.name_key
  LEFT JOIN ${ALBUMS} c ON c.id = (
    SELECT a.id FROM ${ALBUMS} a WHERE a.artist_id = ar.id AND a.cover_hash IS NOT NULL
    ORDER BY a.year IS NULL, a.year DESC LIMIT 1)`;

const toArtist = (r: ArtistRow): ArtistSummary => ({
  id: r.id,
  name: r.name,
  albumCount: r.album_count,
  trackCount: r.track_count,
  photoHash: r.photo_hash,
  coverAlbumId: r.cover_album_id,
  coverHash: r.cover_hash,
});

/** These artists, by id, in the order given; ones with no albums left are skipped. */
export function artistsByIds(ctx: AppContext, userId: number, ids: string[]): ArtistSummary[] {
  if (!ids.length) return [];
  const rows = ctx.sqlite
    .prepare(`${ARTIST_SELECT} WHERE ar.id IN (SELECT value FROM json_each(@ids))`)
    .all({ user: userId, ids: JSON.stringify(ids) }) as ArtistRow[];
  const byId = new Map(rows.filter((r) => r.album_count > 0).map((r) => [r.id, toArtist(r)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/** Every live album's id, artist, genre (Match's wins) and when it was added: what More like ranks on, without the summaries. */
export function albumGenres(ctx: AppContext): Array<{ id: string; artistId: string; artist: string; title: string; genre: string | null; addedAt: number }> {
  return ctx.sqlite
    .prepare(
      `SELECT a.id, a.artist_id AS artistId, ar.name AS artist, a.title, a.genre, a.added_at AS addedAt
       FROM ${ALBUMS} a JOIN artists ar ON ar.id = a.artist_id
       WHERE EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = a.id AND t.missing_since IS NULL)
       ORDER BY a.added_at DESC`,
    )
    .all() as Array<{ id: string; artistId: string; artist: string; title: string; genre: string | null; addedAt: number }>;
}

/** Album artists, A to Z. Artists only featured on others' songs are reached from those songs. */
export function listArtists(ctx: AppContext): ArtistSummary[] {
  const rows = ctx.sqlite.prepare(`${ARTIST_SELECT} ORDER BY ar.sort_name`).all() as ArtistRow[];
  return rows.filter((r) => r.album_count > 0).map(toArtist);
}

/** Everything of theirs on the server, each album and song marked with whether you liked it. */
export async function getArtist(ctx: AppContext, userId: number, id: string): Promise<ArtistDetail | null> {
  const row = ctx.sqlite.prepare(`${ARTIST_SELECT} WHERE ar.id = @id`).get({ id }) as ArtistRow | undefined;
  if (!row || row.track_count === 0) return null;
  const albums = await toAlbums(
    ctx.sqlite
      .prepare(`${ALBUM_SELECT} WHERE a.artist_id = @id GROUP BY a.id ORDER BY a.year IS NULL, a.year DESC, a.title_key`)
      .all({ user: userId, id }) as AlbumRow[],
  );
  const appearsOn = ctx.sqlite
    .prepare(`${TRACK_SELECT} AND t.artist_id = @id AND al.artist_id != @id ORDER BY al.title_key, ${PLAY_ORDER}`)
    .all({ user: userId, id }) as TrackRow[];
  return { ...toArtist(row), albums, appearsOn: appearsOn.map(toTrack) };
}

/** Songs A to Z, or those whose title, artist or album contains `q`. */
export function listTracks(ctx: AppContext, userId: number, q: string | null): TrackDto[] {
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const match = like ? "AND (t.title LIKE @like ESCAPE '\\' OR ar.name LIKE @like ESCAPE '\\' OR al.title LIKE @like ESCAPE '\\')" : "";
  const rows = ctx.sqlite
    .prepare(`${TRACK_SELECT} ${match} ORDER BY t.title COLLATE NOCASE LIMIT ${MAX_TRACKS}`)
    .all(like ? { user: userId, like } : { user: userId }) as TrackRow[];
  return rows.map(toTrack);
}

/** The songs you played most recently, newest first. */
export function recentTracks(ctx: AppContext, userId: number): TrackDto[] {
  const rows = ctx.sqlite
    .prepare(
      `${TRACK_SELECT} AND t.id IN (SELECT track_id FROM track_plays WHERE user_id = @user)
       ORDER BY (SELECT last_played_at FROM track_plays p WHERE p.user_id = @user AND p.track_id = t.id) DESC LIMIT 200`,
    )
    .all({ user: userId }) as TrackRow[];
  return rows.map(toTrack);
}

/** The likes a change names, as [kind, id]. */
const likeKeys = (change: MusicLikeChange): Array<["track" | "album", string]> => [
  ...(change.trackIds ?? []).map((id): ["track", string] => ["track", id]),
  ...(change.albumIds ?? []).map((id): ["album", string] => ["album", id]),
];

/** Likes songs and albums; ones already liked keep their time. Liking an album doesn't like its songs. */
export function like(ctx: AppContext, userId: number, change: MusicLikeChange): void {
  const insert = ctx.sqlite.prepare("INSERT INTO music_likes (user_id, kind, item_id, liked_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING");
  const now = Date.now();
  ctx.sqlite.transaction(() => {
    for (const [kind, id] of likeKeys(change)) insert.run(userId, kind, id, now);
  })();
}

export function unlike(ctx: AppContext, userId: number, change: MusicLikeChange): void {
  const del = ctx.sqlite.prepare("DELETE FROM music_likes WHERE user_id = ? AND kind = ? AND item_id = ?");
  ctx.sqlite.transaction(() => {
    for (const [kind, id] of likeKeys(change)) del.run(userId, kind, id);
  })();
}

/** The Liked tab: liked albums, then liked songs, each newest like first; gone ones are left out. */
export async function likedMusic(ctx: AppContext, userId: number): Promise<LikedMusicDto> {
  const ids = (kind: "track" | "album") =>
    (ctx.sqlite.prepare("SELECT item_id FROM music_likes WHERE user_id = ? AND kind = ? ORDER BY liked_at DESC").all(userId, kind) as Array<{ item_id: string }>).map(
      (r) => r.item_id,
    );
  const albumIds = ids("album");
  const byId = new Map((await albumsByIds(ctx, userId, albumIds)).map((a) => [a.id, a]));
  return { albums: albumIds.flatMap((id) => byId.get(id) ?? []), tracks: tracksByIds(ctx, userId, ids("track")) };
}

/** Where a song's file is, for streaming. */
export function getTrackFile(ctx: AppContext, id: string): { root: string | null; relPath: string; mimeType: string } | null {
  const row = ctx.sqlite
    .prepare(
      `SELECT f.path AS root, t.rel_path AS relPath, t.mime_type AS mimeType
       FROM tracks t LEFT JOIN library_folders f ON f.id = t.folder_id WHERE t.id = ?`,
    )
    .get(id) as { root: string | null; relPath: string; mimeType: string } | undefined;
  return row ?? null;
}

// ---------- Playing ----------

/** One more play of a song. */
const PLAY_ID_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export function addTrackPlay(
  ctx: AppContext,
  userId: number,
  trackId: string,
  source: { kind: "album" | "artist" | "songs" | "playlist"; refId: string | null } | null,
  sent: { playId: string | null; playedAt: number | null } = { playId: null, playedAt: null },
): void {
  // A play from the outbox keeps its time, but never one ahead of the server's clock.
  const now = Math.min(sent.playedAt ?? Date.now(), Date.now());
  if (sent.playId) {
    const seen = ctx.sqlite
      .prepare("INSERT INTO track_play_ids (user_id, play_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
      .run(userId, sent.playId, Date.now());
    if (seen.changes === 0) return;
    ctx.sqlite.prepare("DELETE FROM track_play_ids WHERE created_at < ?").run(Date.now() - PLAY_ID_KEEP_MS);
  }
  // A play sent late doesn't move the song back in time.
  ctx.sqlite
    .prepare(
      `INSERT INTO track_plays (user_id, track_id, count, last_played_at) VALUES (?, ?, 1, ?)
       ON CONFLICT (user_id, track_id) DO UPDATE SET count = count + 1, last_played_at = MAX(last_played_at, excluded.last_played_at)`,
    )
    .run(userId, trackId, now);
  // Jump back in: the album or playlist it came from. From an artist, that's the song's album;
  // Songs from a list (Liked, On repeat, search) say nothing about what you'd go back to.
  let recent: { kind: "album" | "playlist"; refId: string } | null = null;
  if ((source?.kind === "album" || source?.kind === "playlist") && source.refId) recent = { kind: source.kind, refId: source.refId };
  else if (source?.kind === "artist") {
    const row = ctx.sqlite.prepare("SELECT album_id FROM tracks WHERE id = ?").get(trackId) as { album_id: string } | undefined;
    if (row) recent = { kind: "album", refId: row.album_id };
  }
  if (recent) {
    ctx.sqlite
      .prepare(
        `INSERT INTO recent_sources (user_id, kind, ref_id, last_played_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, kind, ref_id) DO UPDATE SET last_played_at = MAX(last_played_at, excluded.last_played_at)`,
      )
      .run(userId, recent.kind, recent.refId, now);
  }
}

/** A single song, for the player to resume with after a reload. */
export function getTrack(ctx: AppContext, userId: number, id: string): TrackDto | null {
  const row = ctx.sqlite.prepare(`${TRACK_SELECT} AND t.id = @id`).get({ user: userId, id }) as TrackRow | undefined;
  return row ? toTrack(row) : null;
}

/** These songs, by id, in the order given; songs gone from the server are left out. */
export function tracksByIds(ctx: AppContext, userId: number, ids: string[]): TrackDto[] {
  if (!ids.length) return [];
  const found = new Map(
    (ctx.sqlite.prepare(`${TRACK_SELECT} AND t.id IN (SELECT value FROM json_each(@ids))`).all({ user: userId, ids: JSON.stringify(ids) }) as TrackRow[]).map(
      (r) => [r.id, toTrack(r)],
    ),
  );
  return ids.flatMap((id) => found.get(id) ?? []);
}
