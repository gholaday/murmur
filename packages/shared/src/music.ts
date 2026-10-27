// Music: what the server sends for the Music tab, album and artist pages, and songs.

import { apiPaths } from "./api-paths";
import { clock, duration, plural } from "./format";

export type AlbumSort = "added" | "name" | "artist" | "year";
export const ALBUM_SORTS: Array<{ id: AlbumSort; label: string }> = [
  { id: "added", label: "Recently added" },
  { id: "name", label: "Album" },
  { id: "artist", label: "Artist" },
  { id: "year", label: "Year" },
];

/** "mine" is your music (songs you added, and their albums and artists); "all" is Browse. */
export type MusicScope = "mine" | "all";

/** An album counts as new in Browse for this long after the scan finds it. */
export const NEW_ALBUM_DAYS = 14;

/** Whether the server has music at all, and how much. Music is hidden everywhere when `enabled` is false. */
export interface MusicSummaryDto {
  /** At least one music folder is set up. */
  enabled: boolean;
  albums: number;
  artists: number;
  tracks: number;
  /** Albums found in the last NEW_ALBUM_DAYS days. */
  newAlbums: number;
  /** Your music: albums you have any songs from, and how many songs. */
  mine: { albums: number; tracks: number };
}

/** What music is playing from; Up Next shows the songs after `index` as one row. */
export interface PlayContextDto {
  kind: "album" | "artist" | "songs";
  /** The album or artist, for a link back. */
  refId: string | null;
  /** "Back In Black", "AC/DC" or "Your songs". */
  title: string;
  /** In play order (shuffled already when `shuffled`); songs gone from the server are left out. */
  tracks: TrackDto[];
  /** The song playing now. */
  index: number;
  shuffled: boolean;
}

/** A song counts as played after this long, or half its length if that's shorter. */
export const PLAY_COUNTS_AFTER_SEC = 30;

/** In random order (Fisher-Yates), with `first` moved to the front when given. */
export function shuffled<T>(list: T[], first?: T): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  if (first !== undefined) {
    const at = out.indexOf(first);
    if (at > 0) out.unshift(...out.splice(at, 1));
  }
  return out;
}

/** Add or remove songs from your music; an album adds or removes all its songs. */
export interface MusicMineChange {
  trackIds?: string[];
  albumIds?: string[];
}

export interface AlbumSummary {
  id: string;
  title: string;
  artistId: string;
  artist: string;
  year: string | null;
  genre: string | null;
  /** Append as `?h=` to the cover URL for permanent caching. */
  coverHash: string | null;
  /** Dominant cover colour (#rrggbb) for placeholders. */
  coverColor: string | null;
  trackCount: number;
  durationSec: number;
  addedAt: number;
  /** How many of its songs are in your music; equal to trackCount when all are. */
  songsInMusic: number;
}

export interface TrackDto {
  id: string;
  title: string;
  albumId: string;
  album: string;
  /** The song's own artist; differs from the album's on compilations and features. */
  artistId: string;
  artist: string;
  discNo: number | null;
  trackNo: number | null;
  durationSec: number;
  mimeType: string;
  /** The album's cover, which songs share. */
  coverHash: string | null;
  /** You added it to your music. */
  inMusic: boolean;
}

export interface AlbumDetail extends AlbumSummary {
  /** In play order: disc, then track number, then title. */
  tracks: TrackDto[];
}

export interface ArtistSummary {
  id: string;
  name: string;
  albumCount: number;
  trackCount: number;
  /** An album of theirs to show until artist photos exist. */
  coverAlbumId: string | null;
  coverHash: string | null;
}

export interface ArtistDetail extends ArtistSummary {
  /** Their own albums, newest first. */
  albums: AlbumSummary[];
  /** Songs of theirs on other artists' albums (compilations, features). */
  appearsOn: TrackDto[];
}

// ---------- Display helpers, shared by the web and the app ----------

/** An album's cover URL, or null when it has none (draw the placeholder). */
export const albumCover = (albumId: string, coverHash: string | null, size: 200 | 600 = 200): string | null =>
  coverHash ? apiPaths.albumCoverUrl(albumId, coverHash, size) : null;

/** The line under a song in mixed lists: "Artist, Album". */
export const songSub = (t: TrackDto): string => `${t.artist}, ${t.album}`;

/** A song's length as 3:42, or blank when unknown. */
export const songLength = (t: TrackDto): string => (t.durationSec > 0 ? clock(t.durationSec) : "");

/** The number shown beside a song on its album: its track number, else its place in the list. */
export const songNumber = (t: TrackDto, index: number): number => t.trackNo ?? index + 1;

/** A song by someone other than the album's artist shows its own artist under the title. */
export const guestArtist = (t: TrackDto, albumArtistId: string): string | null => (t.artistId !== albumArtistId ? t.artist : null);

/** The grey pills on an album page: year, song count, length. */
export function albumPills(a: AlbumSummary): string[] {
  return [a.year, plural(a.trackCount, "song"), duration(a.durationSec)].filter((p): p is string => !!p);
}

/** The line under an artist's name: albums, or songs when they only appear on others' albums. */
export const artistSub = (a: ArtistSummary): string => (a.albumCount ? plural(a.albumCount, "album") : plural(a.trackCount, "song"));

/** How much of an album is in your music. */
export const albumInMusic = (a: AlbumSummary): "all" | "some" | "none" =>
  a.songsInMusic === 0 ? "none" : a.songsInMusic >= a.trackCount ? "all" : "some";

/** "In your music", "3 of 10 songs", or null when none are. */
export function albumInMusicLabel(a: AlbumSummary): string | null {
  const state = albumInMusic(a);
  if (state === "none") return null;
  return state === "all" ? "In your music" : `${a.songsInMusic} of ${plural(a.trackCount, "song")}`;
}

/** Found by the scan in the last NEW_ALBUM_DAYS days. */
export const isNewAlbum = (a: AlbumSummary, now: number = Date.now()): boolean => now - a.addedAt < NEW_ALBUM_DAYS * 86_400_000;

/** An album's songs split by disc; one group with `disc: null` when there's only one disc. */
export function albumDiscs(tracks: TrackDto[]): Array<{ disc: number | null; tracks: TrackDto[] }> {
  const out: Array<{ disc: number | null; tracks: TrackDto[] }> = [];
  for (const t of tracks) {
    const disc = t.discNo ?? 1;
    const last = out.at(-1);
    if (last && last.disc === disc) last.tracks.push(t);
    else out.push({ disc, tracks: [t] });
  }
  return out.length > 1 ? out : [{ disc: null, tracks }];
}

// ---------- Search and sort on the device ----------

const has = (q: string, ...fields: Array<string | null>) => fields.some((f) => f?.toLowerCase().includes(q));

/** `q` is the trimmed, lower-cased search; empty matches everything. */
export const albumMatches = (a: AlbumSummary, q: string) => !q || has(q, a.title, a.artist);
export const artistMatches = (a: ArtistSummary, q: string) => !q || has(q, a.name);
export const songMatches = (t: TrackDto, q: string) => !q || has(q, t.title, t.artist, t.album);

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const artistKey = (s: string) => s.replace(/^the\s+/i, "");

/** The same orders the server sorts by, so changing the sort needs no round trip. */
export function sortAlbums(albums: AlbumSummary[], sort: AlbumSort): AlbumSummary[] {
  const list = [...albums];
  if (sort === "added") return list.sort((a, b) => b.addedAt - a.addedAt || byText(a.title, b.title));
  if (sort === "name") return list.sort((a, b) => byText(a.title, b.title));
  if (sort === "artist") {
    return list.sort((a, b) => byText(artistKey(a.artist), artistKey(b.artist)) || byText(a.year ?? "", b.year ?? "") || byText(a.title, b.title));
  }
  return list.sort((a, b) => (b.year ?? "").localeCompare(a.year ?? "") || byText(a.title, b.title));
}

/** Each artist's own albums, newest first. */
export function albumsByArtist(albums: AlbumSummary[]): Map<string, AlbumSummary[]> {
  const out = new Map<string, AlbumSummary[]>();
  for (const a of albums) out.set(a.artistId, [...(out.get(a.artistId) ?? []), a]);
  for (const list of out.values()) list.sort((x, y) => (y.year ?? "").localeCompare(x.year ?? ""));
  return out;
}
