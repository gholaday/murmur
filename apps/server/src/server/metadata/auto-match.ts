import type { AlbumMatchAllField, MatchField } from "@murmur/shared";
import { bumpChanges } from "../changes";
import type { AppContext } from "../context";
import { createLogger, errorMessage } from "../log";
import { planAlbumMatch } from "../music/match-all";
import { applyAlbumMatch, searchAlbumMatches } from "../music/match";
import { planMatch } from "./bulk-match";
import { applyMatch, fillAudibleGenres, searchMatches } from "./match";

/**
 * Books and albums matched on their own after each scan, like movies and shows. Each one not
 * tried yet is searched like Match, and only a sure result is applied: a book scores 100 only
 * when title, author and length agree, an album only when its songs do. Either way it's marked
 * tried, so it's never asked again; the rest are left for Match or Match all. When every source
 * fails the pass stops, and what's left waits for the next scan.
 */

const SURE = 100;
const PAUSE_MS = 1000;
/** What Match all takes by default, less the title (already the same) and chapters (too risky). */
const BOOK_FIELDS: MatchField[] = ["cover", "author", "narrator", "series", "year", "description"];
/** Match all's own rules decide which of these are worth changing. */
const ALBUM_FIELDS: AlbumMatchAllField[] = ["cover", "year", "genre"];

const log = createLogger("auto-match");

declare global {
  var __murmurAutoMatch: { running: Promise<void> | null; again: boolean } | undefined;
}
const state = (globalThis.__murmurAutoMatch ??= { running: null, again: false });

const pause = () => new Promise((r) => setTimeout(r, PAUSE_MS));

export function autoMatching(): boolean {
  return state.running !== null;
}

/** Matches what's new; asked while a pass runs, another pass follows it. */
export function autoMatchPending(getCtx: () => Promise<AppContext>): Promise<void> {
  if (state.running) {
    state.again = true;
    return state.running;
  }
  state.running = (async () => {
    const ctx = await getCtx();
    do {
      state.again = false;
      await matchBooks(ctx);
      await matchAlbums(ctx);
      await fillBookGenres(ctx);
    } while (state.again);
  })()
    .catch((err: unknown) => log.warn("auto-match failed", { error: errorMessage(err) }))
    .finally(() => {
      state.running = null;
    });
  return state.running;
}

async function matchBooks(ctx: AppContext) {
  const rows = ctx.sqlite
    .prepare(
      `SELECT b.id, b.title FROM books b LEFT JOIN book_overrides o ON o.book_id = b.id
       WHERE b.match_tried_at IS NULL AND b.missing_since IS NULL AND o.provider IS NULL AND COALESCE(o.marked_matched, 0) = 0`,
    )
    .all() as Array<{ id: string; title: string }>;
  await eachOnce(rows, ctx.sqlite.prepare("UPDATE books SET match_tried_at = ? WHERE id = ?"), async (book) => {
    const result = await searchMatches(ctx, book.id, {});
    const top = result.candidates[0];
    if (!top && result.errors.length) return result.errors;
    if (top && top.score >= SURE) {
      const { fields } = await planMatch(ctx, BOOK_FIELDS, book.id, top);
      await applyMatch(ctx, book.id, { provider: top.provider, providerId: top.providerId, fields });
      bumpChanges("books");
      log.info("matched", { title: book.title, to: top.title, provider: top.provider });
    }
    return null;
  });
}

/**
 * Genres for books matched on Audible before they were kept, for More like. Each is fetched once
 * ('[]' when Audible has none); when Audible can't be reached the rest waits for the next scan.
 */
async function fillBookGenres(ctx: AppContext) {
  const rows = ctx.sqlite
    .prepare("SELECT book_id AS id, provider_id FROM book_overrides WHERE provider = 'audible' AND provider_id IS NOT NULL AND genres IS NULL")
    .all() as Array<{ id: string; provider_id: string }>;
  // A second apart, so a big library takes a while the first time.
  if (rows.length) log.info("filling book genres", { books: rows.length });
  for (const [i, row] of rows.entries()) {
    if (i > 0) await pause();
    try {
      await fillAudibleGenres(ctx, row.id, row.provider_id);
    } catch (err) {
      log.warn("Audible unreachable, genres wait for the next scan", { error: errorMessage(err) });
      return;
    }
  }
  if (rows.length) {
    bumpChanges("books");
    log.info("book genres filled", { books: rows.length });
  }
}

async function matchAlbums(ctx: AppContext) {
  const rows = ctx.sqlite
    .prepare(
      `SELECT a.id, a.title FROM albums a LEFT JOIN album_overrides o ON o.album_id = a.id
       WHERE a.match_tried_at IS NULL AND o.album_id IS NULL
         AND EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = a.id AND t.missing_since IS NULL)`,
    )
    .all() as Array<{ id: string; title: string }>;
  await eachOnce(rows, ctx.sqlite.prepare("UPDATE albums SET match_tried_at = ? WHERE id = ?"), async (album) => {
    const result = await searchAlbumMatches(ctx, album.id, {});
    const top = result.candidates[0];
    if (!top && result.errors.length) return result.errors;
    if (top && top.score >= SURE) {
      const { changes } = await planAlbumMatch(ctx, ALBUM_FIELDS, album.id, top);
      await applyAlbumMatch(ctx, album.id, { provider: top.provider, providerId: top.providerId, fields: changes.map((c) => c.field) });
      bumpChanges("music");
      log.info("matched", { album: album.title, to: top.title, provider: top.provider });
    }
    return null;
  });
}

/**
 * Tries each item, a second apart, and marks it tried. One that fails (often a source busy for a
 * moment) is left unmarked for the next scan; `attempt` returning the sources' errors stops the pass.
 */
async function eachOnce<T extends { id: string; title: string }>(
  rows: T[],
  tried: { run: (at: number, id: string) => unknown },
  attempt: (row: T) => Promise<string[] | null>,
) {
  for (const [i, row] of rows.entries()) {
    if (i > 0) await pause();
    try {
      const unreachable = await attempt(row);
      if (unreachable) {
        log.warn("sources unreachable, the rest waits for the next scan", { errors: unreachable });
        return;
      }
      tried.run(Date.now(), row.id);
    } catch (err) {
      log.warn("couldn't match, trying again after the next scan", { title: row.title, error: errorMessage(err) });
    }
  }
}
