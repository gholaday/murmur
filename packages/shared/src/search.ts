import type { BookSummary, EpisodeWithShow, PodcastSummary } from "./index";
import { searchKey } from "./library";
import type { AlbumSummary, ArtistSummary, TrackDto } from "./music";
import type { WatchCard, WatchPoster } from "./watch";

// ---------- Search everywhere ----------

/** The Search screen's tabs, in order. Hidden tabs are left out. */
export const SEARCH_KINDS = ["all", "books", "podcasts", "music", "watch"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** Per group: a few on All, a long list on a kind's own tab. */
export const SEARCH_LIMIT = { all: 8, kind: 50 } as const;

/** A name with how many books it's on: an author (or narrator) or a series. */
export interface SearchName {
  name: string;
  books: number;
}

/**
 * `GET /api/search`. Each group is best match first; groups of hidden tabs, and of the kinds the
 * `kind` asked for leaves out, are empty. Episodes carry short notes, like other lists.
 */
export interface SearchResultsDto {
  q: string;
  books: BookSummary[];
  authors: SearchName[];
  series: SearchName[];
  podcasts: PodcastSummary[];
  episodes: EpisodeWithShow[];
  artists: ArtistSummary[];
  albums: AlbumSummary[];
  songs: TrackDto[];
  /** Movies and shows together. */
  watch: WatchPoster[];
  /** TV episodes, as Continue watching cards. */
  tvEpisodes: WatchCard[];
}

const RECENT_MAX = 8;

/** `term` put first among the recent searches, once, ignoring case; the oldest drop off past 8. */
export function withRecent(recent: readonly string[], term: string): string[] {
  const t = term.trim();
  if (!t) return [...recent];
  const lower = t.toLowerCase();
  return [t, ...recent.filter((r) => r.toLowerCase() !== lower)].slice(0, RECENT_MAX);
}

/** A saved list of recent searches, cleaned: only strings, at most 8. */
export const parseRecent = (saved: unknown): string[] =>
  Array.isArray(saved) ? saved.filter((s): s is string => typeof s === "string").slice(0, RECENT_MAX) : [];

/** Whether a search found anything of a kind; it decides which kind tabs show. */
export function hasKind(r: SearchResultsDto, kind: SearchKind): boolean {
  switch (kind) {
    case "books":
      return r.books.length + r.authors.length + r.series.length > 0;
    case "podcasts":
      return r.podcasts.length + r.episodes.length > 0;
    case "music":
      return r.artists.length + r.albums.length + r.songs.length > 0;
    case "watch":
      return r.watch.length + r.tvEpisodes.length > 0;
    case "all":
      return (["books", "podcasts", "music", "watch"] as const).some((k) => hasKind(r, k));
  }
}

/**
 * The words of a search as an FTS5 trigram query: each word of 3 or more characters, quoted so
 * nothing in it is read as query syntax. Null when no word is long enough, as trigram needs 3;
 * the server then matches names that start with it instead.
 */
export function ftsQuery(q: string): string | null {
  const words = q
    .trim()
    .split(/\s+/)
    .filter((w) => [...w].length >= 3);
  return words.length ? words.map((w) => `"${w.replace(/"/g, '""')}"`).join(" ") : null;
}

/**
 * How well a name matches, lower first: the whole name, its start, a word's start, anywhere in it,
 * then not in the name at all (found by its people or notes). Sorting by this keeps the index's
 * own order within each tier.
 */
export function nameTier(name: string, q: string): number {
  const n = searchKey(name);
  const k = searchKey(q);
  if (!k) return 4;
  if (n === k) return 0;
  if (n.startsWith(k)) return 1;
  if (` ${n}`.includes(` ${k}`)) return 2;
  return n.includes(k) ? 3 : 4;
}

/** Sorts hits by `nameTier`, keeping the order given within a tier. */
export function byNameTier<T>(items: T[], name: (item: T) => string, q: string): T[] {
  return items
    .map((item, i) => ({ item, i, tier: nameTier(name(item), q) }))
    .sort((a, b) => a.tier - b.tier || a.i - b.i)
    .map((x) => x.item);
}
