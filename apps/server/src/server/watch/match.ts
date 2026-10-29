import type { Sqlite } from "../db";
import { HttpError } from "../http";
import type { Logger } from "../log";
import { errorMessage } from "../log";
import { ProviderError } from "../metadata/providers";
import { storeArt } from "./art";
import { pickMatch, tmdbIdFromName } from "./match-score";
import { sortTitle } from "./parse";
import { bumpChanges } from "../changes";
import { createLimiter } from "../library/probe";
import type { Tmdb, TmdbDetails, TmdbKind, TmdbSearchResult } from "./tmdb";

type Table = "movies" | "shows";

interface ParentRow {
  id: string;
  rel_path: string;
  title: string;
  year: string | null;
  poster_hash: string | null;
  backdrop_hash: string | null;
  details_local: number;
  poster_tmdb: number;
  backdrop_tmdb: number;
}

const tableOf = (kind: TmdbKind): Table => (kind === "movie" ? "movies" : "shows");

/**
 * Online details for movies and shows, Plex style: matched on their own after each scan, and
 * fixed by an admin with Match. Local details (.nfo) and local pictures always win; TMDB fills
 * the rest, and only what came from TMDB is replaced by a later match.
 */
export function createWatchMatcher(deps: { sqlite: Sqlite; coversDir: string; log: Logger; tmdb: Tmdb }) {
  const { sqlite, log, tmdb } = deps;
  let running: Promise<void> | null = null;
  let again = false;
  const stillLimit = createLimiter(4);

  const getRow = (table: Table, id: string) =>
    sqlite
      .prepare(`SELECT id, rel_path, title, year, poster_hash, backdrop_hash, details_local, poster_tmdb, backdrop_tmdb FROM ${table} WHERE id = ?`)
      .get(id) as ParentRow | undefined;

  /** A TMDB picture stored like a local one; null when there's none or it can't be fetched. */
  async function picture(imagePath: string | null, shape: "poster" | "wide"): Promise<string | null> {
    if (!imagePath) return null;
    try {
      return await storeArt(deps.coversDir, await tmdb.image(imagePath, shape === "poster" ? "w780" : "w1280"), shape);
    } catch (err) {
      log.warn("TMDB picture could not be stored", { path: imagePath, error: errorMessage(err) });
      return null;
    }
  }

  /** Episode details for the seasons of a show that you have files for. */
  async function fillSeasons(showId: string, tmdbId: number, only?: number[]) {
    const seasons =
      only ??
      (sqlite.prepare("SELECT DISTINCT season FROM videos WHERE show_id = ? AND season IS NOT NULL").all(showId) as Array<{ season: number }>).map(
        (r) => r.season,
      );
    const upsert = sqlite.prepare(
      `INSERT INTO tmdb_episodes (show_id, season, episode, title, overview, air_date, still_hash) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (show_id, season, episode) DO UPDATE SET title = excluded.title, overview = excluded.overview,
         air_date = excluded.air_date, still_hash = COALESCE(excluded.still_hash, tmdb_episodes.still_hash)`,
    );
    const exists = sqlite.prepare("SELECT 1 FROM shows WHERE id = ?");
    for (const season of seasons) {
      // A long season is dozens of stills: a few at a time rather than one after another.
      await Promise.all(
        (await tmdb.season(tmdbId, season)).map((e) =>
          stillLimit(async () => {
            const still = await picture(e.stillPath, "wide");
            // Matching runs beside the scan, which removes a show none of whose files could be read.
            if (exists.get(showId)) upsert.run(showId, e.season, e.episode, e.title, e.overview, e.airDate, still);
          }),
        ),
      );
    }
  }

  /** Puts a TMDB title's details and pictures on a movie or show, then a show's episode details. */
  async function apply(table: Table, row: ParentRow, d: TmdbDetails) {
    const title = row.details_local ? row.title : d.title || row.title;
    const year = row.details_local ? row.year : (d.year ?? row.year);
    // Only a TMDB picture or none at all makes way; your own pictures stay.
    const poster = row.poster_hash && !row.poster_tmdb ? null : await picture(d.posterPath, "poster");
    const backdrop = row.backdrop_hash && !row.backdrop_tmdb ? null : await picture(d.backdropPath, "wide");
    sqlite
      .prepare(
        `UPDATE ${table} SET tmdb_id = ?, matched_at = ?, title = ?, sort_title = ?, year = ?,
           description = CASE WHEN details_local = 1 THEN description ELSE COALESCE(?, description) END,
           poster_hash = CASE WHEN ? IS NOT NULL THEN ? WHEN poster_tmdb = 1 THEN NULL ELSE poster_hash END,
           poster_tmdb = CASE WHEN ? IS NOT NULL THEN 1 WHEN poster_tmdb = 1 THEN 0 ELSE poster_tmdb END,
           backdrop_hash = CASE WHEN ? IS NOT NULL THEN ? WHEN backdrop_tmdb = 1 THEN NULL ELSE backdrop_hash END,
           backdrop_tmdb = CASE WHEN ? IS NOT NULL THEN 1 WHEN backdrop_tmdb = 1 THEN 0 ELSE backdrop_tmdb END,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(d.id, Date.now(), title, sortTitle(title), year, d.overview, poster, poster, poster, backdrop, backdrop, backdrop, Date.now(), row.id);
    // Said now, so the poster shows and the log moves while a long show's episodes come in.
    bumpChanges("watch");
    log.info("matched", { kind: table === "shows" ? "show" : "movie", title: row.title, tmdb: d.title });
    if (table === "shows") {
      const started = Date.now();
      sqlite.prepare("DELETE FROM tmdb_episodes WHERE show_id = ?").run(row.id);
      await fillSeasons(row.id, d.id);
      bumpChanges("watch");
      log.info("episode details filled", { title: title, ms: Date.now() - started });
    }
  }

  /** The TMDB id to use without asking: one written in the name, else a confident search result. */
  async function findId(kind: TmdbKind, row: ParentRow): Promise<number | null> {
    const named = tmdbIdFromName(row.rel_path);
    if (named) return named;
    const local = { title: row.title, year: row.year ? Number(row.year) : null };
    // The year narrows the search; a year off (festival against release) needs it without.
    const withYear = row.year ? pickMatch(local, await tmdb.search(kind, row.title, row.year)) : null;
    return (withYear ?? pickMatch(local, await tmdb.search(kind, row.title, null)))?.id ?? null;
  }

  async function matchAll() {
    for (const kind of ["movie", "show"] as const) {
      const table = tableOf(kind);
      const ids = sqlite.prepare(`SELECT id FROM ${table} WHERE matched_at IS NULL AND folder_id IS NOT NULL`).all() as Array<{ id: string }>;
      for (const { id } of ids) {
        const row = getRow(table, id);
        if (!row) continue;
        const tmdbId = await findId(kind, row);
        const d = tmdbId ? await tmdb.details(kind, tmdbId) : null;
        if (d) {
          await apply(table, row, d);
        } else {
          sqlite.prepare(`UPDATE ${table} SET matched_at = ? WHERE id = ?`).run(Date.now(), id);
          log.info("no confident match", { kind, title: row.title });
        }
      }
    }
    // Seasons added since a show was matched.
    const missing = sqlite
      .prepare(
        `SELECT DISTINCT s.id, s.tmdb_id, v.season FROM shows s JOIN videos v ON v.show_id = s.id
         WHERE s.tmdb_id IS NOT NULL AND v.season IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM tmdb_episodes t WHERE t.show_id = s.id AND t.season = v.season)`,
      )
      .all() as Array<{ id: string; tmdb_id: number; season: number }>;
    for (const m of missing) await fillSeasons(m.id, m.tmdb_id, [m.season]);
  }

  /**
   * Everything not tried yet, one request at a time. When TMDB can't be reached it stops and the
   * rest waits for the next scan; a title with no confident result is marked tried. A scan asks as
   * it finds each movie and show, so asking while a pass runs makes another pass follow it.
   */
  async function matchPending(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await matchAll();
      } while (again);
    })()
      .catch((err) => {
        if (!(err instanceof ProviderError)) throw err;
        log.warn("TMDB unreachable, matching waits for the next scan", { error: err.message });
      })
      .finally(() => {
        running = null;
        // Asked for just as the last pass ended.
        if (again) void matchPending().catch((err: unknown) => log.warn("matching failed", { error: errorMessage(err) }));
      });
    return running;
  }

  async function search(kind: TmdbKind, query: string, year: string | null): Promise<TmdbSearchResult[]> {
    try {
      return await tmdb.search(kind, query, year);
    } catch (err) {
      if (err instanceof ProviderError) throw new HttpError(502, `TMDB ${err.message}.`);
      throw err;
    }
  }

  /** Match: an admin picked this TMDB title for a movie or show. */
  async function matchTo(kind: TmdbKind, id: string, tmdbId: number): Promise<void> {
    const table = tableOf(kind);
    const row = getRow(table, id);
    if (!row) throw new HttpError(404, kind === "movie" ? "Movie not found." : "Show not found.");
    try {
      const d = await tmdb.details(kind, tmdbId);
      if (!d) throw new HttpError(404, "TMDB doesn't have that title any more.");
      await apply(table, row, d);
    } catch (err) {
      if (err instanceof ProviderError) throw new HttpError(502, `TMDB ${err.message}.`);
      throw err;
    }
  }

  return { matchPending, search, matchTo, busy: () => running !== null };
}

export type WatchMatcher = ReturnType<typeof createWatchMatcher>;
