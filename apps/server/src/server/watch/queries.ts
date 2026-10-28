import path from "node:path";
import type {
  EpisodePlayDto,
  MovieDetail,
  MovieSummary,
  MovieVersion,
  ShowDetail,
  ShowSummary,
  VideoAudioTrack,
  VideoEpisode,
  VideoFileInfo,
  VideoProgress,
  VideoSubtitleTrack,
  WatchCard,
  WatchHomeDto,
  WatchPoster,
  WatchSummaryDto,
} from "@murmur/shared";
import type { AppContext } from "../context";
import { env } from "../env";
import { coverColors } from "../library/covers";
import { resolveInside } from "../stream";

// Read side of Watch: the Watch tab, movie and show pages. Videos whose file has gone missing
// are left out, and so are movies and shows left with none. Progress is the shared `progress`
// table with item type "video": a movie's id for movies (shared by its versions), an episode's id
// for episodes. So a movie resumes on any device like a book, whichever version plays.

interface VideoRow {
  id: string;
  kind: "movie" | "episode";
  folder_id: number | null;
  rel_path: string;
  movie_id: string | null;
  edition: string | null;
  show_id: string | null;
  season: number | null;
  episode: number | null;
  title: string;
  description: string | null;
  duration_sec: number;
  size: number;
  container: string;
  video_codec: string | null;
  width: number | null;
  height: number | null;
  hdr: VideoFileInfo["hdr"];
  audio_tracks: string;
  subtitle_tracks: string;
  still_hash: string | null;
  added_at: number;
}

interface ParentRow {
  id: string;
  title: string;
  year: string | null;
  description: string | null;
  poster_hash: string | null;
  backdrop_hash: string | null;
  tmdb_id: number | null;
  added_at: number;
}

interface ShowRow extends ParentRow {
  /** The first episode's still, to tint the show's tile when it has no poster. */
  first_still: string | null;
  seasons: number;
  episodes: number;
  watched: number;
}

/** Specials (season 0) go last, then by number. */
const EPISODE_ORDER = "v.season = 0, v.season, v.episode, v.rel_path";
/** Biggest picture first, then the bigger file: the version Play starts. */
const VERSION_ORDER = "v.height IS NULL, v.height DESC, v.size DESC";
/** Recently added stops here; the Movies and Shows chips have the rest. */
const RECENT_LIMIT = 24;
const CONTINUE_LIMIT = 20;

const LIVE = "v.missing_since IS NULL AND v.folder_id IS NOT NULL";
/**
 * An episode with TMDB's title, description and still in place of the file's, once its show is
 * matched; an episode's own -thumb picture still wins. The aliases come after v.* so they win.
 */
const EPISODE_COLUMNS = `v.*, COALESCE(te.title, v.title) AS title, COALESCE(te.overview, v.description) AS description,
  CASE WHEN v.still_from_file = 1 THEN v.still_hash ELSE COALESCE(te.still_hash, v.still_hash) END AS still_hash`;
const EPISODE_JOIN = "LEFT JOIN tmdb_episodes te ON te.show_id = v.show_id AND te.season = v.season AND te.episode = v.episode";

function progressFor(ctx: AppContext, userId: number): Map<string, VideoProgress> {
  const rows = ctx.sqlite
    .prepare("SELECT item_id, position_sec, finished, updated_at FROM progress WHERE user_id = ? AND item_type = 'video'")
    .all(userId) as Array<{ item_id: string; position_sec: number; finished: number; updated_at: number }>;
  return new Map(rows.map((r) => [r.item_id, { positionSec: r.position_sec, finished: r.finished === 1, updatedAt: r.updated_at }]));
}

const stillOrNull = (hash: string | null) => (hash ? hash : null); // "" means a frame grab failed

function fileInfo(r: VideoRow): VideoFileInfo {
  return {
    container: r.container,
    videoCodec: r.video_codec,
    width: r.width,
    height: r.height,
    hdr: r.hdr,
    audioTracks: JSON.parse(r.audio_tracks) as VideoAudioTrack[],
    subtitleTracks: JSON.parse(r.subtitle_tracks) as VideoSubtitleTrack[],
    size: r.size,
    fileName: path.posix.basename(r.rel_path),
  };
}

const toVersion = (r: VideoRow): MovieVersion => ({
  id: r.id,
  edition: r.edition,
  durationSec: r.duration_sec,
  stillHash: stillOrNull(r.still_hash),
  file: fileInfo(r),
});

/** Each movie's live versions, biggest first; `movieId` limits it to one. */
function versionsByMovie(ctx: AppContext, movieId?: string): Map<string, VideoRow[]> {
  const rows = ctx.sqlite
    .prepare(`SELECT * FROM videos v WHERE v.kind = 'movie' AND ${LIVE} ${movieId ? "AND v.movie_id = @movieId" : ""} ORDER BY ${VERSION_ORDER}`)
    .all(movieId ? { movieId } : {}) as VideoRow[];
  const out = new Map<string, VideoRow[]>();
  for (const r of rows) out.set(r.movie_id!, [...(out.get(r.movie_id!) ?? []), r]);
  return out;
}

/** Header tints for posters, by hash. */
type Colors = Map<string, string>;
const colorsFor = (hashes: Array<string | null>): Promise<Colors> => coverColors(env.coversDir, hashes);
const colorOf = (colors: Colors, hash: string | null) => (hash ? (colors.get(hash) ?? null) : null);

function toMovie(m: ParentRow, versions: VideoRow[], progress: Map<string, VideoProgress>, colors: Colors): MovieSummary {
  const first = versions[0]!;
  return {
    id: m.id,
    title: m.title,
    year: m.year,
    durationSec: first.duration_sec,
    posterHash: m.poster_hash,
    color: colorOf(colors, m.poster_hash || first.still_hash),
    stillHash: stillOrNull(first.still_hash),
    versions: versions.length,
    addedAt: m.added_at,
    progress: progress.get(m.id) ?? null,
  };
}

const toEpisode = (r: VideoRow, progress: Map<string, VideoProgress>): VideoEpisode => ({
  id: r.id,
  showId: r.show_id!,
  season: r.season ?? 1,
  episode: r.episode ?? 0,
  title: r.title,
  description: r.description,
  durationSec: r.duration_sec,
  stillHash: stillOrNull(r.still_hash),
  progress: progress.get(r.id) ?? null,
  file: fileInfo(r),
});

const SHOW_SELECT = `
  SELECT s.id, s.title, s.year, s.description, s.poster_hash, s.backdrop_hash, s.tmdb_id, s.added_at,
         (SELECT v2.still_hash FROM videos v2 WHERE v2.show_id = s.id AND v2.still_hash != ''
          ORDER BY v2.season = 0, v2.season, v2.episode LIMIT 1) AS first_still,
         COUNT(DISTINCT v.season) AS seasons, COUNT(v.id) AS episodes,
         SUM(EXISTS (SELECT 1 FROM progress p WHERE p.user_id = @user AND p.item_type = 'video' AND p.item_id = v.id AND p.finished = 1)) AS watched
  FROM shows s JOIN videos v ON v.show_id = s.id AND ${LIVE}`;

const toShow = (r: ShowRow, colors: Colors): ShowSummary => ({
  id: r.id,
  title: r.title,
  year: r.year,
  posterHash: r.poster_hash,
  color: colorOf(colors, r.poster_hash || r.first_still),
  seasons: r.seasons,
  episodes: r.episodes,
  watched: r.watched ?? 0,
  addedAt: r.added_at,
});

export function watchEnabled(ctx: AppContext): boolean {
  const { movies, shows } = ctx.watch.folders();
  return movies.length + shows.length > 0;
}

/** Movies with at least one live version, A to Z (or newest first for Recently added). */
function movieRows(ctx: AppContext, order: "title" | "added", limit?: number): Array<{ movie: ParentRow; versions: VideoRow[] }> {
  const versions = versionsByMovie(ctx);
  const rows = ctx.sqlite
    .prepare(`SELECT * FROM movies ORDER BY ${order === "title" ? "sort_title, year" : "added_at DESC"}`)
    .all() as ParentRow[];
  const live = rows.filter((m) => versions.has(m.id)).map((movie) => ({ movie, versions: versions.get(movie.id)! }));
  return limit ? live.slice(0, limit) : live;
}

/** How many movies and shows there are, and whether Watch is set up at all. */
export function watchSummary(ctx: AppContext): WatchSummaryDto {
  const counts = ctx.sqlite
    .prepare(
      `SELECT (SELECT COUNT(DISTINCT movie_id) FROM videos v WHERE v.kind = 'movie' AND ${LIVE}) AS movies,
              (SELECT COUNT(DISTINCT show_id) FROM videos v WHERE v.kind = 'episode' AND ${LIVE}) AS shows`,
    )
    .get() as { movies: number; shows: number };
  return { enabled: watchEnabled(ctx), ...counts };
}

export async function listMovies(ctx: AppContext, userId: number): Promise<MovieSummary[]> {
  const progress = progressFor(ctx, userId);
  const rows = movieRows(ctx, "title");
  const colors = await colorsFor(rows.map((r) => r.movie.poster_hash || r.versions[0]!.still_hash));
  return rows.map(({ movie, versions }) => toMovie(movie, versions, progress, colors));
}

export async function getMovie(ctx: AppContext, userId: number, id: string): Promise<MovieDetail | null> {
  const movie = ctx.sqlite.prepare("SELECT * FROM movies WHERE id = ?").get(id) as ParentRow | undefined;
  const versions = movie ? versionsByMovie(ctx, id).get(id) : undefined;
  if (!movie || !versions) return null;
  return {
    ...toMovie(movie, versions, progressFor(ctx, userId), await colorsFor([movie.poster_hash || versions[0]!.still_hash])),
    description: movie.description,
    backdropHash: movie.backdrop_hash,
    tmdbId: movie.tmdb_id,
    versionList: versions.map(toVersion),
  };
}

export async function listShows(ctx: AppContext, userId: number): Promise<ShowSummary[]> {
  const rows = ctx.sqlite.prepare(`${SHOW_SELECT} GROUP BY s.id ORDER BY s.sort_title, s.year`).all({ user: userId }) as ShowRow[];
  const colors = await colorsFor(rows.map((r) => r.poster_hash || r.first_still));
  return rows.map((r) => toShow(r, colors));
}

/**
 * Where a show's Resume goes: the episode you're partway through (the most recent, if several),
 * else the first unwatched one after the last you finished, else the first unwatched one.
 */
export function showUpNext(episodes: VideoEpisode[]): string | null {
  const started = episodes
    .filter((e) => e.progress && !e.progress.finished && e.progress.positionSec > 0)
    .sort((a, b) => b.progress!.updatedAt - a.progress!.updatedAt)[0];
  if (started) return started.id;
  let lastFinished = -1;
  let latest = 0;
  episodes.forEach((e, i) => {
    if (e.progress?.finished && e.progress.updatedAt >= latest) {
      latest = e.progress.updatedAt;
      lastFinished = i;
    }
  });
  const after = episodes.slice(lastFinished + 1).find((e) => !e.progress?.finished);
  return (after ?? episodes.find((e) => !e.progress?.finished))?.id ?? null;
}

function showEpisodes(ctx: AppContext, showId: string, progress: Map<string, VideoProgress>): VideoEpisode[] {
  const rows = ctx.sqlite
    .prepare(`SELECT ${EPISODE_COLUMNS} FROM videos v ${EPISODE_JOIN} WHERE v.show_id = ? AND ${LIVE} ORDER BY ${EPISODE_ORDER}`)
    .all(showId) as VideoRow[];
  return rows.map((r) => toEpisode(r, progress));
}

export async function getShow(ctx: AppContext, userId: number, id: string): Promise<ShowDetail | null> {
  const row = ctx.sqlite.prepare(`${SHOW_SELECT} WHERE s.id = @id GROUP BY s.id`).get({ user: userId, id }) as ShowRow | undefined;
  if (!row) return null;
  const episodes = showEpisodes(ctx, id, progressFor(ctx, userId));
  const seasonList: ShowDetail["seasonList"] = [];
  for (const e of episodes) {
    const last = seasonList.at(-1);
    if (last?.season === e.season) last.episodes.push(e);
    else seasonList.push({ season: e.season, episodes: [e] });
  }
  return {
    ...toShow(row, await colorsFor([row.poster_hash || row.first_still])),
    description: row.description,
    backdropHash: row.backdrop_hash,
    tmdbId: row.tmdb_id,
    seasonList,
    upNextId: showUpNext(episodes),
  };
}

/** An episode with its show and what follows it, for the player. */
export async function getEpisodePlay(ctx: AppContext, userId: number, id: string): Promise<EpisodePlayDto | null> {
  const row = ctx.sqlite
    .prepare(`SELECT v.show_id, s.title, s.poster_hash FROM videos v JOIN shows s ON s.id = v.show_id WHERE v.id = ? AND ${LIVE}`)
    .get(id) as { show_id: string; title: string; poster_hash: string | null } | undefined;
  if (!row) return null;
  const episodes = showEpisodes(ctx, row.show_id, progressFor(ctx, userId));
  const at = episodes.findIndex((e) => e.id === id);
  if (at < 0) return null;
  const art = row.poster_hash || episodes[at]!.stillHash;
  const color = colorOf(await colorsFor([art]), art);
  return { episode: episodes[at]!, show: { id: row.show_id, title: row.title, color }, next: episodes.slice(at + 1) };
}

function episodeCard(e: VideoEpisode, showTitle: string): WatchCard {
  return {
    id: e.id,
    kind: "episode",
    title: showTitle,
    showId: e.showId,
    season: e.season,
    episode: e.episode,
    episodeTitle: e.title,
    durationSec: e.durationSec,
    stillHash: e.stillHash,
    stillId: e.id,
    posterHash: null,
    progress: e.progress,
  };
}

export async function watchHome(ctx: AppContext, userId: number): Promise<WatchHomeDto> {
  if (!watchEnabled(ctx)) return { enabled: false, continueWatching: [], nextEpisodes: [], recentlyAdded: [] };
  const progress = progressFor(ctx, userId);
  const noColors: Colors = new Map();
  const partway = [...progress.entries()]
    .filter(([, p]) => !p.finished && p.positionSec > 0)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt);

  // Movies and episodes you're partway through, most recent first.
  const allMovies = movieRows(ctx, "added");
  const movieById = new Map(allMovies.map((m) => [m.movie.id, m]));
  const episodeById = ctx.sqlite.prepare(
    `SELECT ${EPISODE_COLUMNS}, s.title AS show_title FROM videos v JOIN shows s ON s.id = v.show_id ${EPISODE_JOIN} WHERE v.id = ? AND ${LIVE}`,
  );
  const continueWatching: WatchCard[] = [];
  const continuingShows = new Set<string>();
  for (const [id] of partway) {
    if (continueWatching.length >= CONTINUE_LIMIT) break;
    const movie = movieById.get(id);
    if (movie) {
      const m = toMovie(movie.movie, movie.versions, progress, noColors);
      continueWatching.push({
        id: m.id,
        kind: "movie",
        title: m.title,
        showId: null,
        season: null,
        episode: null,
        episodeTitle: null,
        durationSec: m.durationSec,
        stillHash: m.stillHash,
        stillId: movie.versions[0]!.id,
        posterHash: m.posterHash,
        progress: m.progress,
      });
      continue;
    }
    const ep = episodeById.get(id) as (VideoRow & { show_title: string }) | undefined;
    if (ep) {
      continuingShows.add(ep.show_id!);
      continueWatching.push(episodeCard(toEpisode(ep, progress), ep.show_title));
    }
  }

  // Shows you've watched some of and aren't partway through an episode of: their next episode.
  const startedShows = ctx.sqlite
    .prepare(
      `SELECT v.show_id, s.title, MAX(p.updated_at) AS at FROM progress p
       JOIN videos v ON v.id = p.item_id JOIN shows s ON s.id = v.show_id
       WHERE p.user_id = ? AND p.item_type = 'video'
       GROUP BY v.show_id ORDER BY at DESC`,
    )
    .all(userId) as Array<{ show_id: string; title: string }>;
  const nextEpisodes: WatchCard[] = [];
  for (const show of startedShows) {
    if (continuingShows.has(show.show_id) || nextEpisodes.length >= CONTINUE_LIMIT) continue;
    const episodes = showEpisodes(ctx, show.show_id, progress);
    const next = episodes.find((e) => e.id === showUpNext(episodes));
    if (next) nextEpisodes.push(episodeCard(next, show.title));
  }

  const shows = ctx.sqlite
    .prepare(`${SHOW_SELECT} GROUP BY s.id ORDER BY MAX(v.added_at) DESC LIMIT ${RECENT_LIMIT}`)
    .all({ user: userId }) as ShowRow[];
  const recentMovies = allMovies.slice(0, RECENT_LIMIT);
  const movieTint = (m: (typeof recentMovies)[number]) => m.movie.poster_hash || m.versions[0]!.still_hash;
  const showTint = (s: ShowRow) => s.poster_hash || s.first_still;
  const colors = await colorsFor([...recentMovies.map(movieTint), ...shows.map(showTint)]);
  const recentlyAdded: WatchPoster[] = [
    ...recentMovies.map((m) => ({
      kind: "movie" as const,
      id: m.movie.id,
      title: m.movie.title,
      year: m.movie.year,
      posterHash: m.movie.poster_hash,
      color: colorOf(colors, movieTint(m)),
      watched: progress.get(m.movie.id)?.finished ?? false,
      addedAt: m.movie.added_at,
    })),
    ...shows.map((s) => ({
      kind: "show" as const,
      id: s.id,
      title: s.title,
      year: s.year,
      posterHash: s.poster_hash,
      color: colorOf(colors, showTint(s)),
      watched: s.episodes > 0 && s.watched === s.episodes,
      addedAt: s.added_at,
    })),
  ].sort((a, b) => b.addedAt - a.addedAt);

  return { enabled: true, continueWatching, nextEpisodes, recentlyAdded };
}

/** A movie version's or episode's still. */
export function videoStillHash(ctx: AppContext, id: string): string | null {
  const row = ctx.sqlite.prepare(`SELECT ${EPISODE_COLUMNS} FROM videos v ${EPISODE_JOIN} WHERE v.id = ?`).get(id) as
    | { still_hash: string | null }
    | undefined;
  return row?.still_hash || null;
}

export function movieArtHash(ctx: AppContext, id: string, kind: "poster" | "backdrop"): string | null {
  const column = kind === "poster" ? "poster_hash" : "backdrop_hash";
  const row = ctx.sqlite.prepare(`SELECT ${column} AS h FROM movies WHERE id = ?`).get(id) as { h: string | null } | undefined;
  return row?.h ?? null;
}

export function showArtHash(ctx: AppContext, id: string, kind: "poster" | "backdrop"): string | null {
  const column = kind === "poster" ? "poster_hash" : "backdrop_hash";
  const row = ctx.sqlite.prepare(`SELECT ${column} AS h FROM shows WHERE id = ?`).get(id) as { h: string | null } | undefined;
  return row?.h ?? null;
}

/** Where a video's file is, for streaming. `root` is null once its folder was removed. */
/** What preparing a video needs to know about it; null when it's gone or its folder was removed. */
export function getPrepareSource(
  ctx: AppContext,
  id: string,
): {
  file: string;
  mtimeMs: number;
  durationSec: number;
  videoCodec: string | null;
  width: number | null;
  height: number | null;
  hdr: VideoFileInfo["hdr"];
  audioCodecs: string[];
} | null {
  const file = getVideoFile(ctx, id);
  if (!file?.root) return null;
  const row = ctx.sqlite.prepare("SELECT mtime_ms, duration_sec, video_codec, width, height, hdr, audio_tracks FROM videos WHERE id = ?").get(id) as
    | {
        mtime_ms: number;
        duration_sec: number;
        video_codec: string | null;
        width: number | null;
        height: number | null;
        hdr: VideoFileInfo["hdr"];
        audio_tracks: string;
      }
    | undefined;
  if (!row) return null;
  return {
    file: resolveInside(file.root, file.relPath),
    mtimeMs: row.mtime_ms,
    durationSec: row.duration_sec,
    videoCodec: row.video_codec,
    width: row.width,
    height: row.height,
    hdr: row.hdr,
    /** Each audio track's RFC 6381 codec, in file order. */
    audioCodecs: (JSON.parse(row.audio_tracks) as VideoAudioTrack[]).map((t) => t.codec),
  };
}

export function getVideoFile(ctx: AppContext, id: string): { root: string | null; relPath: string } | null {
  const row = ctx.sqlite.prepare("SELECT folder_id, rel_path FROM videos WHERE id = ? AND missing_since IS NULL").get(id) as
    | { folder_id: number | null; rel_path: string }
    | undefined;
  if (!row) return null;
  const { movies, shows } = ctx.watch.folders();
  const root = [...movies, ...shows].find((f) => f.id === row.folder_id)?.path ?? null;
  return { root, relPath: row.rel_path };
}
