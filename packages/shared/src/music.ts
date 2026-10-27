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

/** Whether the server has music at all, and how much. Music is hidden everywhere when `enabled` is false. */
export interface MusicSummaryDto {
  /** At least one music folder is set up. */
  enabled: boolean;
  albums: number;
  artists: number;
  tracks: number;
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
