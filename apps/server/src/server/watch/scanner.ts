import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Sqlite } from "../db";
import { errorMessage, type Logger } from "../log";
import type { LibraryFolder } from "../library/folders";
import { IMAGE_EXTENSIONS, extname, isIgnoredName } from "../library/parse";
import { createLimiter } from "../library/probe";
import type { ScanState } from "../library/scanner";
import { storeArt } from "./art";
import { grabStill, probeVideo, videoProblem } from "./video-addon";
import {
  ART_NAMES,
  editionOf,
  episodeInfo,
  isExtra,
  isVideoFile,
  movieInfo,
  movieKey,
  parseNameYear,
  parseNfo,
  pickArt,
  sortTitle,
  stem,
  type NfoInfo,
} from "./parse";

// The Watch scanner. Like music it goes file by file: a video is probed only when its size or
// modified time changed. Movies and shows have their own folders, so nothing is guessed.

export interface WatchScannerDeps {
  sqlite: Sqlite;
  /** The movies and shows folders, looked up at the start of every scan. */
  folders: () => { movies: LibraryFolder[]; shows: LibraryFolder[] };
  coversDir: string;
  probeConcurrency: number;
  missingGraceMs: number;
  log: Logger;
  state: ScanState;
  /** Online details for anything not matched yet, run after each scan when TMDB is set up. */
  matchPending?: () => Promise<void>;
}

interface FoundFile {
  relPath: string;
  size: number;
  mtimeMs: number;
}

interface Walked {
  videos: FoundFile[];
  /** Image and .nfo names by folder (relative, forward slashes, "" for the top). */
  extras: Map<string, string[]>;
}

interface VideoRow {
  id: string;
  rel_path: string;
  size: number;
  mtime_ms: number;
  missing_since: number | null;
}

const newId = () => crypto.randomBytes(9).toString("base64url");
const fsLimit = createLimiter(16);
const dirOf = (relPath: string) => {
  const d = path.posix.dirname(relPath);
  return d === "." ? "" : d;
};

/** Every video file under a folder, and the images and .nfo files next to them. */
async function walk(root: string, log: Logger): Promise<Walked> {
  const out: Walked = { videos: [], extras: new Map() };
  async function visit(rel: string): Promise<void> {
    let entries;
    try {
      entries = (await fsLimit(() => fs.readdir(path.join(root, rel), { withFileTypes: true }))).filter((e) => !isIgnoredName(e.name));
    } catch (err) {
      if (rel === "") throw err;
      log.warn("cannot read folder, skipping", { folder: rel, error: errorMessage(err) });
      return;
    }
    const extras: string[] = [];
    await Promise.all(
      entries.map(async (e) => {
        const relPath = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) return visit(relPath);
        if (!e.isFile()) return;
        const ext = extname(e.name);
        if (IMAGE_EXTENSIONS.has(ext) || ext === ".nfo") extras.push(e.name);
        else if (isVideoFile(e.name) && !isExtra(relPath)) {
          const st = await fsLimit(() => fs.stat(path.join(root, relPath)));
          out.videos.push({ relPath, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
        }
      }),
    );
    if (extras.length) out.extras.set(rel, extras);
  }
  await visit("");
  return out;
}

export function createWatchScanner(deps: WatchScannerDeps) {
  const { sqlite, log, state } = deps;
  const probeLimit = createLimiter(Math.max(1, deps.probeConcurrency));

  const upsertVideo = sqlite.prepare(`
    INSERT INTO videos (id, kind, folder_id, rel_path, movie_id, edition, show_id, season, episode, title, sort_title,
                        year, description, duration_sec, size, mtime_ms, container, video_codec, width, height, hdr,
                        audio_tracks, subtitle_tracks, added_at, missing_since)
    VALUES (@id, @kind, @folderId, @relPath, @movieId, @edition, @showId, @season, @episode, @title, @sortTitle,
            @year, @description, @durationSec, @size, @mtimeMs, @container, @videoCodec, @width, @height, @hdr,
            @audioTracks, @subtitleTracks, @now, NULL)
    ON CONFLICT (folder_id, rel_path) DO UPDATE SET
      movie_id = excluded.movie_id, edition = excluded.edition, show_id = excluded.show_id, season = excluded.season, episode = excluded.episode, title = excluded.title,
      sort_title = excluded.sort_title, year = excluded.year, description = excluded.description,
      duration_sec = excluded.duration_sec, size = excluded.size, mtime_ms = excluded.mtime_ms,
      container = excluded.container, video_codec = excluded.video_codec, width = excluded.width,
      height = excluded.height, hdr = excluded.hdr, audio_tracks = excluded.audio_tracks,
      subtitle_tracks = excluded.subtitle_tracks, still_hash = NULL, still_from_file = 0, missing_since = NULL`);
  const findParent = {
    shows: sqlite.prepare("SELECT id FROM shows WHERE folder_id = ? AND rel_path = ?"),
    movies: sqlite.prepare("SELECT id FROM movies WHERE folder_id = ? AND rel_path = ?"),
  };
  const insertParent = {
    shows: sqlite.prepare(
      `INSERT INTO shows (id, folder_id, rel_path, title, sort_title, year, description, details_local, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    movies: sqlite.prepare(
      `INSERT INTO movies (id, folder_id, rel_path, title, sort_title, year, description, details_local, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
  };

  async function readNfo(root: string, dir: string, names: string[], wanted: string[]): Promise<NfoInfo | null> {
    const name = pickArt(names.filter((n) => extname(n) === ".nfo"), wanted);
    if (!name) return null;
    try {
      return parseNfo(await fs.readFile(path.join(root, dir, name), "utf8"));
    } catch {
      return null;
    }
  }

  /** Shows and movies being looked up this scan, so files imported side by side don't each make one. */
  const pendingParents = new Map<string, Promise<string>>();

  /**
   * The show or movie a file belongs to, made the first time one of its files is found. Its title
   * comes from the folder (or the file, for a loose movie), and tvshow.nfo or movie.nfo win.
   */
  function parentId(
    table: "shows" | "movies",
    folder: LibraryFolder,
    relPath: string,
    file: FoundFile,
    extras: Map<string, string[]>,
    now: number,
  ): Promise<string> {
    const key = `${table}/${folder.id}/${relPath}`;
    let pending = pendingParents.get(key);
    if (!pending) {
      pending = (async () => {
        const row = findParent[table].get(folder.id, relPath) as { id: string } | undefined;
        if (row) return row.id;
        const loose = relPath === file.relPath;
        const named = table === "shows" ? parseNameYear(relPath) : movieInfo(file.relPath);
        const dir = loose ? dirOf(relPath) : relPath;
        const fileStem = stem(path.posix.basename(file.relPath));
        const wanted = table === "shows" ? ["tvshow"] : loose ? [fileStem] : ["movie", fileStem];
        const nfo = await readNfo(folder.path, dir, extras.get(dir) ?? [], wanted);
        const id = newId();
        const title = nfo?.title ?? named.title;
        const detailsLocal = nfo?.title ? 1 : 0;
        insertParent[table].run(id, folder.id, relPath, title, sortTitle(title), nfo?.year ?? named.year, nfo?.plot ?? null, detailsLocal, now, now);
        // Matching needs only the title and year, so it starts now rather than after every file is read.
        deps.matchPending?.().catch((err) => log.warn("matching failed", { error: errorMessage(err) }));
        return id;
      })();
      pendingParents.set(key, pending);
    }
    return pending;
  }

  async function importVideo(
    kind: "movie" | "episode",
    folder: LibraryFolder,
    file: FoundFile,
    extras: Map<string, string[]>,
    now: number,
  ): Promise<"ok" | "failed" | "skipped"> {
    const dir = dirOf(file.relPath);
    const fileName = path.posix.basename(file.relPath);
    let base: {
      title: string;
      movieId: string | null;
      edition: string | null;
      showId: string | null;
      season: number | null;
      episode: number | null;
    };
    if (kind === "movie") {
      const movieId = await parentId("movies", folder, movieKey(file.relPath), file, extras, now);
      base = { title: movieInfo(file.relPath).title, movieId, edition: editionOf(fileName), showId: null, season: null, episode: null };
    } else {
      const ep = episodeInfo(file.relPath);
      if (!ep) {
        log.debug("not an episode, skipping", { file: file.relPath });
        return "skipped";
      }
      const showId = await parentId("shows", folder, ep.showPath, file, extras, now);
      base = { title: ep.title, movieId: null, edition: null, showId, season: ep.season, episode: ep.episode };
    }
    let probe;
    try {
      probe = await probeLimit(() => probeVideo(path.join(folder.path, file.relPath)));
    } catch (err) {
      log.warn("video could not be read", { file: file.relPath, error: errorMessage(err) });
      return "failed";
    }
    // An episode's own nfo; a movie's details live on the movie.
    const nfo = kind === "episode" ? await readNfo(folder.path, dir, extras.get(dir) ?? [], [stem(fileName)]) : null;
    const title = nfo?.title ?? base.title;
    upsertVideo.run({
      id: newId(),
      kind,
      folderId: folder.id,
      relPath: file.relPath,
      movieId: base.movieId,
      edition: base.edition,
      showId: base.showId,
      season: base.season,
      episode: base.episode,
      title,
      sortTitle: sortTitle(title),
      year: nfo?.year ?? null,
      description: nfo?.plot ?? null,
      durationSec: probe.durationSec,
      size: file.size,
      mtimeMs: file.mtimeMs,
      container: probe.container,
      videoCodec: probe.videoCodec,
      width: probe.width,
      height: probe.height,
      hdr: probe.hdr,
      audioTracks: JSON.stringify(probe.audioTracks),
      subtitleTracks: JSON.stringify(probe.subtitleTracks),
      now,
    });
    return "ok";
  }

  async function storeImage(root: string, dir: string, name: string, shape: "poster" | "wide"): Promise<string | null> {
    try {
      return await storeArt(deps.coversDir, await fs.readFile(path.join(root, dir, name)), shape);
    } catch (err) {
      log.warn("picture could not be processed", { file: `${dir}/${name}`, error: errorMessage(err) });
      return null;
    }
  }

  /**
   * Pictures still missing: posters and backdrops from images beside the files, and a 16:9 still
   * for every video, from its -thumb image or backdrop, else a frame a tenth of the way in.
   */
  async function fillArt(extrasByFolder: Map<number, Map<string, string[]>>) {
    const roots = new Map(
      [...deps.folders().movies, ...deps.folders().shows].map((f) => [f.id, f.path] as const),
    );
    const images = (folderId: number, dir: string) =>
      (extrasByFolder.get(folderId)?.get(dir) ?? []).filter((n) => IMAGE_EXTENSIONS.has(extname(n)));

    // Local art wins over TMDB's, which matching may have put there first.
    const setParentArt = (table: "shows" | "movies") =>
      sqlite.prepare(
        `UPDATE ${table} SET poster_hash = COALESCE(?1, poster_hash), poster_tmdb = CASE WHEN ?1 IS NOT NULL THEN 0 ELSE poster_tmdb END,
           backdrop_hash = COALESCE(?2, backdrop_hash), backdrop_tmdb = CASE WHEN ?2 IS NOT NULL THEN 0 ELSE backdrop_tmdb END
         WHERE id = ?3`,
      );
    for (const table of ["shows", "movies"] as const) {
      const parents = sqlite
        .prepare(
          `SELECT id, folder_id, rel_path, poster_hash, backdrop_hash, poster_tmdb, backdrop_tmdb FROM ${table}
           WHERE folder_id IS NOT NULL AND (poster_hash IS NULL OR backdrop_hash IS NULL OR poster_tmdb = 1 OR backdrop_tmdb = 1)`,
        )
        .all() as Array<{
        id: string;
        folder_id: number;
        rel_path: string;
        poster_hash: string | null;
        backdrop_hash: string | null;
        poster_tmdb: number;
        backdrop_tmdb: number;
      }>;
      const setArt = setParentArt(table);
      for (const p of parents) {
        const root = roots.get(p.folder_id);
        if (!root) continue;
        // A loose movie only takes "<file>-poster.jpg"; poster.jpg and the like belong to a folder.
        const loose = table === "movies" && isVideoFile(p.rel_path);
        const dir = loose ? dirOf(p.rel_path) : p.rel_path;
        const fileStem = loose ? stem(path.posix.basename(p.rel_path)) : null;
        const names = images(p.folder_id, dir);
        const posterName = p.poster_hash && !p.poster_tmdb ? null : pickArt(names, loose ? [`${fileStem}-poster`] : ART_NAMES.poster(null));
        const backdropName = p.backdrop_hash && !p.backdrop_tmdb ? null : pickArt(names, loose ? [`${fileStem}-fanart`] : ART_NAMES.backdrop(null));
        const poster = posterName ? await storeImage(root, dir, posterName, "poster") : null;
        const backdrop = backdropName ? await storeImage(root, dir, backdropName, "wide") : null;
        if (poster || backdrop) setArt.run(poster, backdrop, p.id);
      }
    }

    const videos = sqlite
      .prepare(
        `SELECT v.id, v.folder_id, v.rel_path, v.duration_sec, v.hdr, m.backdrop_hash
         FROM videos v LEFT JOIN movies m ON m.id = v.movie_id
         WHERE v.folder_id IS NOT NULL AND v.missing_since IS NULL AND v.still_hash IS NULL`,
      )
      .all() as Array<{ id: string; folder_id: number; rel_path: string; duration_sec: number; hdr: string | null; backdrop_hash: string | null }>;
    const setStill = sqlite.prepare("UPDATE videos SET still_hash = ?, still_from_file = ? WHERE id = ?");
    // The whole body holds a slot: a thumbnail's sharp work is as heavy as a frame grab.
    await Promise.all(
      videos.map((v) =>
        probeLimit(async () => {
          const root = roots.get(v.folder_id);
          if (!root) return;
          const dir = dirOf(v.rel_path);
          const thumb = pickArt(images(v.folder_id, dir), [`${stem(path.posix.basename(v.rel_path))}-thumb`]);
          let still: string | null;
          if (thumb) still = await storeImage(root, dir, thumb, "wide");
          else if (v.backdrop_hash) still = v.backdrop_hash;
          else {
            try {
              const frame = await grabStill(path.join(root, v.rel_path), v.duration_sec, v.hdr !== null);
              still = frame.length ? await storeArt(deps.coversDir, frame, "wide", { trimBars: true }) : "";
            } catch (err) {
              log.warn("frame could not be grabbed", { file: v.rel_path, error: errorMessage(err) });
              // Tried, and the cards fall back to the poster; unless the add-on was away, then the next scan tries again.
              still = (err as { status?: number }).status === 503 ? null : "";
            }
          }
          if (still !== null) setStill.run(still, thumb && still ? 1 : 0, v.id);
        }),
      ),
    );
  }

  async function runOnce() {
    const now = Date.now();
    const stats = { found: 0, added: 0, updated: 0, unchanged: 0, missing: 0, removed: 0, failed: 0 };
    const problems: string[] = [];
    const folders = deps.folders();
    if (folders.movies.length + folders.shows.length === 0) return { stats, problems };
    const problem = await videoProblem();
    if (problem) {
      // Nothing is marked missing: the files are fine, they just can't be read right now.
      problems.push(problem);
      return { stats, problems };
    }

    pendingParents.clear();
    const extrasByFolder = new Map<number, Map<string, string[]>>();
    const setMissing = sqlite.prepare("UPDATE videos SET missing_since = ? WHERE id = ? AND missing_since IS NULL");
    const clearMissing = sqlite.prepare("UPDATE videos SET missing_since = NULL WHERE id = ?");
    const kinds = [
      ...folders.movies.map((f) => ["movie", f] as const),
      ...folders.shows.map((f) => ["episode", f] as const),
    ];
    for (const [kind, folder] of kinds) {
      let walked: Walked;
      try {
        walked = await walk(folder.path, log);
      } catch (err) {
        // An unreachable folder (unmounted share) must not mark everything in it missing.
        problems.push(`${folder.path} can't be read: ${errorMessage(err)}.`);
        continue;
      }
      extrasByFolder.set(folder.id, walked.extras);
      stats.found += walked.videos.length;
      const existing = new Map(
        (sqlite.prepare("SELECT id, rel_path, size, mtime_ms, missing_since FROM videos WHERE folder_id = ?").all(folder.id) as VideoRow[]).map(
          (r) => [r.rel_path, r],
        ),
      );
      await Promise.all(
        walked.videos.map(async (file) => {
          const row = existing.get(file.relPath);
          existing.delete(file.relPath);
          if (row && row.size === file.size && row.mtime_ms === file.mtimeMs) {
            stats.unchanged++;
            if (row.missing_since !== null) clearMissing.run(row.id);
            return;
          }
          const result = await importVideo(kind, folder, file, walked.extras, now);
          if (result === "ok") stats[row ? "updated" : "added"]++;
          else if (result === "failed") stats.failed++;
        }),
      );
      for (const gone of existing.values()) {
        stats.missing++;
        setMissing.run(now, gone.id);
      }
    }

    // Gone long enough, or their folder was removed: delete them, then shows left empty.
    stats.removed = sqlite
      .prepare("DELETE FROM videos WHERE folder_id IS NULL OR (missing_since IS NOT NULL AND missing_since < ?)")
      .run(now - deps.missingGraceMs).changes;
    sqlite.prepare("DELETE FROM shows WHERE folder_id IS NULL OR id NOT IN (SELECT show_id FROM videos WHERE show_id IS NOT NULL)").run();
    sqlite.prepare("DELETE FROM movies WHERE folder_id IS NULL OR id NOT IN (SELECT movie_id FROM videos WHERE movie_id IS NOT NULL)").run();

    await fillArt(extrasByFolder);
    // Online details are optional: a failure there is logged and never fails the scan.
    try {
      await deps.matchPending?.();
    } catch (err) {
      log.warn("matching failed", { error: errorMessage(err) });
    }
    return { stats, problems };
  }

  /** Scans every movies and shows folder. If a scan is already running, another pass starts right after. */
  async function scan(): Promise<void> {
    if (state.running) {
      state.rerunRequested = true;
      return;
    }
    state.running = true;
    try {
      do {
        state.rerunRequested = false;
        const started = Date.now();
        try {
          const { stats, problems } = await runOnce();
          state.lastStats = { ...stats, moved: 0 };
          state.lastError = problems.length ? problems.join(" ") : null;
          if (problems.length) log.warn("watch scan held back", { problems: state.lastError, ms: Date.now() - started });
          else log.info("watch scan finished", { ...stats, ms: Date.now() - started });
        } catch (err) {
          state.lastError = errorMessage(err);
          log.error("watch scan failed", { error: state.lastError });
        } finally {
          state.lastFinishedAt = Date.now();
          state.lastDurationMs = Date.now() - started;
        }
      } while (state.rerunRequested);
    } finally {
      state.running = false;
    }
  }

  return { scan };
}

export type WatchScanner = ReturnType<typeof createWatchScanner>;
