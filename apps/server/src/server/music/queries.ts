import type {
  AlbumDetail,
  AlbumSort,
  AlbumSummary,
  ArtistDetail,
  ArtistSummary,
  MusicMineChange,
  MusicScope,
  MusicSummaryDto,
  PlayContextDto,
  PlayContextInput,
  TrackDto,
} from "@murmur/shared";
import { NEW_ALBUM_DAYS } from "@murmur/shared";
import type { AppContext } from "../context";
import { env } from "../env";
import { coverColors } from "../library/covers";

// Read side of music: everything the Music tab, Browse, album and artist pages show. Songs whose
// file has gone missing are left out, and so are albums left with none.
//
// "Your music" is the songs a person added (user_tracks). Their albums and artists are worked
// out from those songs, so there's nothing else to keep in step.

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
  in_music: number;
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
  in_music: number;
}

/** A song is in @user's music. */
const IN_MUSIC = (track: string) => `EXISTS (SELECT 1 FROM user_tracks ut WHERE ut.user_id = @user AND ut.track_id = ${track})`;

const ALBUM_SELECT = `
  SELECT a.id, a.title, a.artist_id, ar.name AS artist, a.year, a.genre, a.cover_hash, a.added_at,
         COUNT(t.id) AS track_count, SUM(t.duration_sec) AS duration, SUM(${IN_MUSIC("t.id")}) AS in_music
  FROM albums a
  JOIN artists ar ON ar.id = a.artist_id
  JOIN tracks t ON t.album_id = a.id AND t.missing_since IS NULL`;

/** Albums with any of @user's songs. */
const MINE_ALBUMS = `a.id IN (SELECT t2.album_id FROM user_tracks ut JOIN tracks t2 ON t2.id = ut.track_id
                              WHERE ut.user_id = @user AND t2.missing_since IS NULL)`;

const ALBUM_ORDER: Record<AlbumSort, string> = {
  added: "a.added_at DESC, a.title_key",
  name: "a.title_key",
  artist: "ar.sort_name, a.year, a.title_key",
  year: "a.year IS NULL, a.year DESC, a.title_key",
};

const TRACK_SELECT = `
  SELECT t.id, t.title, t.album_id, al.title AS album, t.artist_id, ar.name AS artist,
         t.disc_no, t.track_no, t.duration_sec, t.mime_type, al.cover_hash, ${IN_MUSIC("t.id")} AS in_music
  FROM tracks t
  JOIN albums al ON al.id = t.album_id
  JOIN artists ar ON ar.id = t.artist_id
  WHERE t.missing_since IS NULL`;

/** Disc, then track number, then title: how an album plays. */
const PLAY_ORDER = "COALESCE(t.disc_no, 1), t.track_no IS NULL, t.track_no, t.title COLLATE NOCASE";
/** Song search and lists stop here; a bigger library is browsed by album. */
const MAX_TRACKS = 5000;

async function toAlbums(rows: AlbumRow[]): Promise<AlbumSummary[]> {
  const colors = await coverColors(env.coversDir, rows.map((r) => r.cover_hash));
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
    songsInMusic: r.in_music ?? 0,
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
  inMusic: r.in_music === 1,
});

export function musicSummary(ctx: AppContext, userId: number): MusicSummaryDto {
  const all = ctx.sqlite
    .prepare(
      `SELECT COUNT(*) AS tracks, COUNT(DISTINCT t.album_id) AS albums, COUNT(DISTINCT al.artist_id) AS artists,
              COUNT(DISTINCT CASE WHEN al.added_at > @since THEN al.id END) AS newAlbums
       FROM tracks t JOIN albums al ON al.id = t.album_id WHERE t.missing_since IS NULL`,
    )
    .get({ since: Date.now() - NEW_ALBUM_DAYS * 86_400_000 }) as { tracks: number; albums: number; artists: number; newAlbums: number };
  const mine = ctx.sqlite
    .prepare(
      `SELECT COUNT(*) AS tracks, COUNT(DISTINCT t.album_id) AS albums
       FROM user_tracks ut JOIN tracks t ON t.id = ut.track_id WHERE ut.user_id = @user AND t.missing_since IS NULL`,
    )
    .get({ user: userId }) as { tracks: number; albums: number };
  return { enabled: ctx.music.folders().length > 0, ...all, mine };
}

export function listAlbums(ctx: AppContext, userId: number, scope: MusicScope, sort: AlbumSort): Promise<AlbumSummary[]> {
  const where = scope === "mine" ? `WHERE ${MINE_ALBUMS}` : "";
  return toAlbums(ctx.sqlite.prepare(`${ALBUM_SELECT} ${where} GROUP BY a.id ORDER BY ${ALBUM_ORDER[sort]}`).all({ user: userId }) as AlbumRow[]);
}

export async function getAlbum(ctx: AppContext, userId: number, id: string): Promise<AlbumDetail | null> {
  const [album] = await toAlbums(ctx.sqlite.prepare(`${ALBUM_SELECT} WHERE a.id = @id GROUP BY a.id`).all({ user: userId, id }) as AlbumRow[]);
  if (!album) return null;
  const tracks = ctx.sqlite.prepare(`${TRACK_SELECT} AND t.album_id = @id ORDER BY ${PLAY_ORDER}`).all({ user: userId, id }) as TrackRow[];
  return { ...album, tracks: tracks.map(toTrack) };
}

export function getAlbumCoverHash(ctx: AppContext, id: string): string | null {
  return (ctx.sqlite.prepare("SELECT cover_hash FROM albums WHERE id = ?").get(id) as { cover_hash: string | null } | undefined)?.cover_hash ?? null;
}

interface ArtistRow {
  id: string;
  name: string;
  album_count: number;
  track_count: number;
  cover_album_id: string | null;
  cover_hash: string | null;
}

/**
 * An artist with their album and song counts. With `mine`, only what's in @user's music counts:
 * albums of theirs you have songs from, and those songs.
 */
function artistSelect(mine: boolean): string {
  const minePart = mine ? `AND ${IN_MUSIC("t.id")}` : "";
  return `
  SELECT ar.id, ar.name,
    (SELECT COUNT(DISTINCT t.album_id) FROM tracks t JOIN albums a ON a.id = t.album_id
     WHERE a.artist_id = ar.id AND t.missing_since IS NULL ${minePart}) AS album_count,
    (SELECT COUNT(*) FROM tracks t JOIN albums a ON a.id = t.album_id
     WHERE (t.artist_id = ar.id OR a.artist_id = ar.id) AND t.missing_since IS NULL ${minePart}) AS track_count,
    c.id AS cover_album_id, c.cover_hash
  FROM artists ar
  LEFT JOIN albums c ON c.id = (
    SELECT a.id FROM albums a WHERE a.artist_id = ar.id AND a.cover_hash IS NOT NULL
    ORDER BY a.year IS NULL, a.year DESC LIMIT 1)`;
}

const toArtist = (r: ArtistRow): ArtistSummary => ({
  id: r.id,
  name: r.name,
  albumCount: r.album_count,
  trackCount: r.track_count,
  coverAlbumId: r.cover_album_id,
  coverHash: r.cover_hash,
});

/** Album artists, A to Z. Artists only featured on others' songs are reached from those songs. */
export function listArtists(ctx: AppContext, userId: number, scope: MusicScope): ArtistSummary[] {
  const rows = ctx.sqlite.prepare(`${artistSelect(scope === "mine")} ORDER BY ar.sort_name`).all({ user: userId }) as ArtistRow[];
  return rows.filter((r) => r.album_count > 0).map(toArtist);
}

/** Everything of theirs on the server, each album and song marked with how much is in your music. */
export async function getArtist(ctx: AppContext, userId: number, id: string): Promise<ArtistDetail | null> {
  const row = ctx.sqlite.prepare(`${artistSelect(false)} WHERE ar.id = @id`).get({ user: userId, id }) as ArtistRow | undefined;
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
export function listTracks(ctx: AppContext, userId: number, scope: MusicScope, q: string | null): TrackDto[] {
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const mine = scope === "mine" ? `AND ${IN_MUSIC("t.id")}` : "";
  const match = like ? "AND (t.title LIKE @like ESCAPE '\\' OR ar.name LIKE @like ESCAPE '\\' OR al.title LIKE @like ESCAPE '\\')" : "";
  const rows = ctx.sqlite
    .prepare(`${TRACK_SELECT} ${mine} ${match} ORDER BY t.title COLLATE NOCASE LIMIT ${MAX_TRACKS}`)
    .all(like ? { user: userId, like } : { user: userId }) as TrackRow[];
  return rows.map(toTrack);
}

/** The song ids a change names: its songs, plus every song on its albums. */
function changeTrackIds(ctx: AppContext, change: MusicMineChange): string[] {
  const ids = new Set(change.trackIds ?? []);
  const byAlbum = ctx.sqlite.prepare("SELECT id FROM tracks WHERE album_id = ? AND missing_since IS NULL");
  for (const albumId of change.albumIds ?? []) for (const r of byAlbum.all(albumId) as Array<{ id: string }>) ids.add(r.id);
  return [...ids];
}

/** Adds songs to a person's music; ones already there or not on the server are skipped. */
export function addToMine(ctx: AppContext, userId: number, change: MusicMineChange): number {
  const insert = ctx.sqlite.prepare(
    "INSERT OR IGNORE INTO user_tracks (user_id, track_id, added_at) SELECT ?, id, ? FROM tracks WHERE id = ? AND missing_since IS NULL",
  );
  const now = Date.now();
  return ctx.sqlite.transaction((ids: string[]) => ids.reduce((n, id) => n + insert.run(userId, now, id).changes, 0))(changeTrackIds(ctx, change));
}

export function removeFromMine(ctx: AppContext, userId: number, change: MusicMineChange): number {
  const del = ctx.sqlite.prepare("DELETE FROM user_tracks WHERE user_id = ? AND track_id = ?");
  return ctx.sqlite.transaction((ids: string[]) => ids.reduce((n, id) => n + del.run(userId, id).changes, 0))(changeTrackIds(ctx, change));
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

interface ContextRow {
  kind: PlayContextDto["kind"];
  ref_id: string | null;
  title: string;
  track_ids: string;
  idx: number;
  shuffled: number;
}

/** What a person is playing music from, with its songs; null when there's nothing or none are left. */
export function getPlayContext(ctx: AppContext, userId: number): PlayContextDto | null {
  const row = ctx.sqlite.prepare("SELECT kind, ref_id, title, track_ids, idx, shuffled FROM play_context WHERE user_id = ?").get(userId) as
    | ContextRow
    | undefined;
  if (!row) return null;
  const ids = JSON.parse(row.track_ids) as string[];
  const found = new Map(
    (ctx.sqlite.prepare(`${TRACK_SELECT} AND t.id IN (SELECT value FROM json_each(@ids))`).all({ user: userId, ids: row.track_ids }) as TrackRow[]).map(
      (r) => [r.id, toTrack(r)],
    ),
  );
  // Songs removed from the server drop out; the index follows the song it pointed at.
  const current = ids[row.idx];
  const tracks = ids.flatMap((id) => found.get(id) ?? []);
  if (!tracks.length) return null;
  const index = Math.max(0, tracks.findIndex((t) => t.id === current));
  return { kind: row.kind, refId: row.ref_id, title: row.title, tracks, index, shuffled: row.shuffled === 1 };
}

export function savePlayContext(ctx: AppContext, userId: number, input: PlayContextInput): void {
  ctx.sqlite
    .prepare(
      `INSERT INTO play_context (user_id, kind, ref_id, title, track_ids, idx, shuffled, updated_at)
       VALUES (@user, @kind, @refId, @title, @ids, @index, @shuffled, @now)
       ON CONFLICT (user_id) DO UPDATE SET kind = excluded.kind, ref_id = excluded.ref_id, title = excluded.title,
         track_ids = excluded.track_ids, idx = excluded.idx, shuffled = excluded.shuffled, updated_at = excluded.updated_at`,
    )
    .run({
      user: userId,
      kind: input.kind,
      refId: input.refId,
      title: input.title,
      ids: JSON.stringify(input.trackIds),
      index: Math.min(input.index, input.trackIds.length - 1),
      shuffled: input.shuffled ? 1 : 0,
      now: Date.now(),
    });
}

/** Moves the context on to another of its songs. */
export function setPlayContextIndex(ctx: AppContext, userId: number, index: number): void {
  ctx.sqlite
    .prepare("UPDATE play_context SET idx = MIN(@index, json_array_length(track_ids) - 1), updated_at = @now WHERE user_id = @user")
    .run({ user: userId, index, now: Date.now() });
}

export function clearPlayContext(ctx: AppContext, userId: number): void {
  ctx.sqlite.prepare("DELETE FROM play_context WHERE user_id = ?").run(userId);
}

/** One more play of a song. */
export function addTrackPlay(ctx: AppContext, userId: number, trackId: string): void {
  ctx.sqlite
    .prepare(
      `INSERT INTO track_plays (user_id, track_id, count, last_played_at) VALUES (?, ?, 1, ?)
       ON CONFLICT (user_id, track_id) DO UPDATE SET count = count + 1, last_played_at = excluded.last_played_at`,
    )
    .run(userId, trackId, Date.now());
}

/** A single song, for the player to resume with after a reload. */
export function getTrack(ctx: AppContext, userId: number, id: string): TrackDto | null {
  const row = ctx.sqlite.prepare(`${TRACK_SELECT} AND t.id = @id`).get({ user: userId, id }) as TrackRow | undefined;
  return row ? toTrack(row) : null;
}
