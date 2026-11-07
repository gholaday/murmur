// Search everywhere: books, podcasts, music and Watch from one box. The index (search_index, kept
// in step by triggers; see drizzle/0025_search_index.sql) finds what matches; the usual list
// queries then build each hit, so results look and act like the lists they come from.
import {
  byNameTier,
  ftsQuery,
  nameTier,
  SEARCH_LIMIT,
  searchKey,
  type SearchKind,
  type SearchName,
  type SearchResultsDto,
} from "@murmur/shared";
import { booksByIds } from "./books";
import type { AppContext } from "./context";
import { env } from "./env";
import { createLogger, errorMessage } from "./log";
import { albumsByIds, artistsByIds, tracksByIds } from "./music/queries";
import { episodesByIds, listPodcasts, shortNotes } from "./podcasts/queries";
import { getPrefs } from "./prefs";
import { watchSearchHits } from "./watch/queries";

const log = createLogger("search");

type IndexKind = "book" | "podcast" | "episode" | "artist" | "album" | "track" | "movie" | "show" | "video";

/** Who may see a hit, beyond it still being there (which the list queries check). */
const VISIBLE: Partial<Record<IndexKind, string>> = {
  book: "EXISTS (SELECT 1 FROM books b WHERE b.id = r.ref AND (b.missing_since IS NULL OR b.missing_since > @grace))",
  podcast: "EXISTS (SELECT 1 FROM subscriptions s WHERE s.podcast_id = r.ref AND s.user_id = @user)",
  episode:
    "EXISTS (SELECT 1 FROM episodes e JOIN subscriptions s ON s.podcast_id = e.podcast_id AND s.user_id = @user WHERE e.id = r.ref)",
};

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Ids of one kind of thing that match, best first. Words of 3 or more characters go through the
 * trigram index (names count most, then people); shorter searches match names that
 * start with them, or have a word that does.
 */
function findIds(ctx: AppContext, userId: number, kind: IndexKind, q: string, limit: number): string[] {
  const visible = VISIBLE[kind] ? `AND ${VISIBLE[kind]}` : "";
  const params = { kind, user: userId, grace: Date.now() - env.missingGraceMs, limit: limit * 2 };
  const fts = ftsQuery(q);
  const rows = (
    fts
      ? ctx.sqlite
          .prepare(
            `SELECT r.ref, r.name FROM search_index JOIN search_rows r ON r.id = search_index.rowid
             WHERE search_index MATCH @fts AND r.kind = @kind ${visible}
             ORDER BY bm25(search_index, 10, 4) LIMIT @limit`,
          )
          .all({ ...params, fts })
      : ctx.sqlite
          .prepare(
            `SELECT r.ref, r.name FROM search_rows r
             WHERE r.kind = @kind AND (r.name LIKE @start ESCAPE '\\' OR r.name LIKE @word ESCAPE '\\') ${visible}
             ORDER BY r.name COLLATE NOCASE LIMIT @limit`,
          )
          .all({ ...params, start: `${likeEscape(q)}%`, word: `% ${likeEscape(q)}%` })
  ) as Array<{ ref: string; name: string }>;
  return byNameTier(rows, (r) => r.name, q).map((r) => r.ref);
}

/** Keeps `items` in the order of `ids`, dropping ids with no item (gone, or not yours to see). */
function inOrder<T extends { id: string }>(ids: string[], items: T[], limit: number): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return ids.flatMap((id) => byId.get(id) ?? []).slice(0, limit);
}

/** Authors and series whose name matches, with how many books each is on. */
function bookNames(ctx: AppContext, q: string, limit: number): { authors: SearchName[]; series: SearchName[] } {
  const key = searchKey(q);
  if (!key) return { authors: [], series: [] };
  const rows = ctx.sqlite
    .prepare(
      `SELECT NULLIF(COALESCE(o.author, b.author), '') AS author,
              CASE WHEN o.series IS NOT NULL THEN NULLIF(o.series, '') ELSE b.series END AS series
       FROM books b LEFT JOIN book_overrides o ON o.book_id = b.id
       WHERE b.missing_since IS NULL OR b.missing_since > ?`,
    )
    .all(Date.now() - env.missingGraceMs) as Array<{ author: string | null; series: string | null }>;
  const count = (values: Array<string | null>): SearchName[] => {
    const counts = new Map<string, number>();
    for (const v of values) if (v && searchKey(v).includes(key)) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()]
      .map(([name, books]) => ({ name, books }))
      .sort((a, b) => nameTier(a.name, q) - nameTier(b.name, q) || b.books - a.books || a.name.localeCompare(b.name))
      .slice(0, limit);
  };
  return { authors: count(rows.map((r) => r.author)), series: count(rows.map((r) => r.series)) };
}

const EMPTY = (q: string): SearchResultsDto => ({
  q,
  books: [],
  authors: [],
  series: [],
  podcasts: [],
  episodes: [],
  artists: [],
  albums: [],
  songs: [],
  watch: [],
  tvEpisodes: [],
});

export async function search(ctx: AppContext, userId: number, q: string, kind: SearchKind): Promise<SearchResultsDto> {
  const out = EMPTY(q);
  if (!searchKey(q)) return out;
  const tabs = getPrefs(ctx, userId).tabs;
  const want = (k: Exclude<SearchKind, "all">, shown: boolean | undefined) => shown && (kind === "all" || kind === k);
  const limit = kind === "all" ? SEARCH_LIMIT.all : SEARCH_LIMIT.kind;
  const ids = (k: IndexKind) => findIds(ctx, userId, k, q, limit);

  // Each kind on its own: if one fails, the others still answer.
  const part = async (label: string, run: () => Promise<void> | void) => {
    try {
      await run();
    } catch (err) {
      log.warn("search part failed", { part: label, error: errorMessage(err) });
    }
  };

  await Promise.all([
    want("books", tabs.books !== false) &&
      part("books", async () => {
        const bookIds = ids("book");
        out.books = inOrder(bookIds, await booksByIds(ctx, bookIds, userId), limit);
        Object.assign(out, bookNames(ctx, q, kind === "all" ? 4 : limit));
      }),
    want("podcasts", tabs.podcasts) &&
      part("podcasts", async () => {
        const podcastIds = ids("podcast");
        if (podcastIds.length) out.podcasts = inOrder(podcastIds, await listPodcasts(ctx.sqlite, userId), limit);
        const episodeIds = ids("episode");
        out.episodes = shortNotes(inOrder(episodeIds, await episodesByIds(ctx.sqlite, episodeIds, userId), limit));
      }),
    want("music", tabs.music) &&
      part("music", async () => {
        const artistIds = ids("artist");
        out.artists = inOrder(artistIds, artistsByIds(ctx, userId, artistIds), limit);
        const albumIds = ids("album");
        out.albums = inOrder(albumIds, await albumsByIds(ctx, userId, albumIds), limit);
        out.songs = tracksByIds(ctx, userId, ids("track")).slice(0, limit);
      }),
    want("watch", tabs.watch) &&
      part("watch", async () => {
        const hits = await watchSearchHits(ctx, userId, { movies: ids("movie"), shows: ids("show"), episodes: ids("video") });
        out.watch = byNameTier(hits.posters, (p) => p.title, q).slice(0, limit);
        out.tvEpisodes = hits.episodes.slice(0, limit);
      }),
  ]);
  return out;
}
