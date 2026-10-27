import type { AlbumDetail, AlbumSort, AlbumSummary, ArtistDetail, ArtistSummary, MusicSummaryDto, TrackDto } from "@murmur/shared";
import type { AppContext } from "../context";
import { env } from "../env";
import { coverColors } from "../library/covers";

// Read side of music: everything the Music tab, album and artist pages show. Songs whose
// file has gone missing are left out, and so are albums left with none.

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
}

const ALBUM_SELECT = `
  SELECT a.id, a.title, a.artist_id, ar.name AS artist, a.year, a.genre, a.cover_hash, a.added_at,
         COUNT(t.id) AS track_count, SUM(t.duration_sec) AS duration
  FROM albums a
  JOIN artists ar ON ar.id = a.artist_id
  JOIN tracks t ON t.album_id = a.id AND t.missing_since IS NULL`;

const ALBUM_ORDER: Record<AlbumSort, string> = {
  added: "a.added_at DESC, a.title_key",
  name: "a.title_key",
  artist: "ar.sort_name, a.year, a.title_key",
  year: "a.year IS NULL, a.year DESC, a.title_key",
};

const TRACK_SELECT = `
  SELECT t.id, t.title, t.album_id, al.title AS album, t.artist_id, ar.name AS artist,
         t.disc_no, t.track_no, t.duration_sec, t.mime_type, al.cover_hash
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
});

export function musicSummary(ctx: AppContext): MusicSummaryDto {
  const n = ctx.sqlite
    .prepare(
      `SELECT COUNT(*) AS tracks, COUNT(DISTINCT t.album_id) AS albums, COUNT(DISTINCT al.artist_id) AS artists
       FROM tracks t JOIN albums al ON al.id = t.album_id WHERE t.missing_since IS NULL`,
    )
    .get() as { tracks: number; albums: number; artists: number };
  return { enabled: ctx.music.folders().length > 0, ...n };
}

export function listAlbums(ctx: AppContext, sort: AlbumSort): Promise<AlbumSummary[]> {
  return toAlbums(ctx.sqlite.prepare(`${ALBUM_SELECT} GROUP BY a.id ORDER BY ${ALBUM_ORDER[sort]}`).all() as AlbumRow[]);
}

export async function getAlbum(ctx: AppContext, id: string): Promise<AlbumDetail | null> {
  const [album] = await toAlbums(ctx.sqlite.prepare(`${ALBUM_SELECT} WHERE a.id = ? GROUP BY a.id`).all(id) as AlbumRow[]);
  if (!album) return null;
  const tracks = ctx.sqlite.prepare(`${TRACK_SELECT} AND t.album_id = ? ORDER BY ${PLAY_ORDER}`).all(id) as TrackRow[];
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

const ARTIST_SELECT = `
  SELECT ar.id, ar.name,
    (SELECT COUNT(DISTINCT t.album_id) FROM tracks t JOIN albums a ON a.id = t.album_id
     WHERE a.artist_id = ar.id AND t.missing_since IS NULL) AS album_count,
    (SELECT COUNT(*) FROM tracks t WHERE t.artist_id = ar.id AND t.missing_since IS NULL) AS track_count,
    c.id AS cover_album_id, c.cover_hash
  FROM artists ar
  LEFT JOIN albums c ON c.id = (
    SELECT a.id FROM albums a WHERE a.artist_id = ar.id AND a.cover_hash IS NOT NULL
    ORDER BY a.year IS NULL, a.year DESC LIMIT 1)`;

const toArtist = (r: ArtistRow): ArtistSummary => ({
  id: r.id,
  name: r.name,
  albumCount: r.album_count,
  trackCount: r.track_count,
  coverAlbumId: r.cover_album_id,
  coverHash: r.cover_hash,
});

/** Album artists, A to Z. Artists only featured on others' songs are reached from those songs. */
export function listArtists(ctx: AppContext): ArtistSummary[] {
  const rows = ctx.sqlite.prepare(`${ARTIST_SELECT} ORDER BY ar.sort_name`).all() as ArtistRow[];
  return rows.filter((r) => r.album_count > 0).map(toArtist);
}

export async function getArtist(ctx: AppContext, id: string): Promise<ArtistDetail | null> {
  const row = ctx.sqlite.prepare(`${ARTIST_SELECT} WHERE ar.id = ?`).get(id) as ArtistRow | undefined;
  if (!row || (row.album_count === 0 && row.track_count === 0)) return null;
  const albums = await toAlbums(
    ctx.sqlite.prepare(`${ALBUM_SELECT} WHERE a.artist_id = ? GROUP BY a.id ORDER BY a.year IS NULL, a.year DESC, a.title_key`).all(id) as AlbumRow[],
  );
  const appearsOn = ctx.sqlite
    .prepare(`${TRACK_SELECT} AND t.artist_id = ? AND al.artist_id != ? ORDER BY al.title_key, ${PLAY_ORDER}`)
    .all(id, id) as TrackRow[];
  return { ...toArtist(row), albums, appearsOn: appearsOn.map(toTrack) };
}

/** Songs A to Z, or those whose title, artist or album contains `q`. */
export function listTracks(ctx: AppContext, q: string | null): TrackDto[] {
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const rows = like
    ? (ctx.sqlite
        .prepare(
          `${TRACK_SELECT} AND (t.title LIKE ? ESCAPE '\\' OR ar.name LIKE ? ESCAPE '\\' OR al.title LIKE ? ESCAPE '\\')
           ORDER BY t.title COLLATE NOCASE LIMIT ${MAX_TRACKS}`,
        )
        .all(like, like, like) as TrackRow[])
    : (ctx.sqlite.prepare(`${TRACK_SELECT} ORDER BY t.title COLLATE NOCASE LIMIT ${MAX_TRACKS}`).all() as TrackRow[]);
  return rows.map(toTrack);
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
