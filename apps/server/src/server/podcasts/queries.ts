import type { EpisodeDto, EpisodeWithShow, PodcastDetail, PodcastSummary } from "@murmur/shared";
import type { Sqlite } from "../db";
import { env } from "../env";
import { coverColors } from "../library/covers";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface PodcastRow {
  id: string;
  title: string;
  author: string | null;
  cover_hash: string | null;
  last_error: string | null;
  description: string | null;
  link: string | null;
  feed_url: string;
  last_checked_at: number | null;
  episode_count: number;
  unplayed_count: number;
  latest_published_at: number | null;
  speed: number;
}

// "New for you": published no more than a week before the user subscribed, not finished and
// not archived, so subscribing to a show with 300 back episodes doesn't start with "300 unplayed".
const IS_NEW = `e.published_at >= s.created_at - ${WEEK_MS}
  AND (pr.finished IS NULL OR pr.finished = 0)
  AND NOT EXISTS (SELECT 1 FROM episode_archives a WHERE a.user_id = s.user_id AND a.episode_id = e.id)`;

/** Listened past the first few seconds and not finished, same rule as books. */
const IS_STARTED = `COALESCE(pr.finished = 0 AND pr.position_sec > 5, 0)`;

const PODCAST_SELECT = `
  SELECT p.*, s.speed,
    (SELECT COUNT(*) FROM episodes e WHERE e.podcast_id = p.id) AS episode_count,
    (SELECT MAX(published_at) FROM episodes e WHERE e.podcast_id = p.id) AS latest_published_at,
    (SELECT COUNT(*) FROM episodes e
       LEFT JOIN progress pr ON pr.user_id = s.user_id AND pr.item_type = 'episode' AND pr.item_id = e.id
       WHERE e.podcast_id = p.id AND ${IS_NEW}) AS unplayed_count
  FROM podcasts p
  JOIN subscriptions s ON s.podcast_id = p.id AND s.user_id = ?`;

function toSummary(r: PodcastRow, colors: Map<string, string>): PodcastSummary {
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    coverHash: r.cover_hash,
    coverColor: r.cover_hash ? (colors.get(r.cover_hash) ?? null) : null,
    episodeCount: r.episode_count,
    unplayedCount: r.unplayed_count,
    latestPublishedAt: r.latest_published_at,
    speed: r.speed,
    lastError: r.last_error,
  };
}

export async function listPodcasts(sqlite: Sqlite, userId: number): Promise<PodcastSummary[]> {
  const rows = sqlite.prepare(`${PODCAST_SELECT} ORDER BY latest_published_at DESC`).all(userId) as PodcastRow[];
  const colors = await coverColors(env.coversDir, rows.map((r) => r.cover_hash));
  return rows.map((r) => toSummary(r, colors));
}

/** Only returns podcasts the user is subscribed to. */
export async function getPodcast(sqlite: Sqlite, podcastId: string, userId: number): Promise<PodcastDetail | null> {
  const r = sqlite.prepare(`${PODCAST_SELECT} WHERE p.id = ?`).get(userId, podcastId) as PodcastRow | undefined;
  if (!r) return null;
  const colors = await coverColors(env.coversDir, [r.cover_hash]);
  return {
    ...toSummary(r, colors),
    description: r.description,
    link: r.link,
    feedUrl: r.feed_url,
    lastCheckedAt: r.last_checked_at,
  };
}

interface EpisodeRow {
  id: string;
  podcast_id: string;
  title: string;
  description: string | null;
  published_at: number;
  duration_sec: number | null;
  audio_url: string;
  image_url: string | null;
  season: number | null;
  episode_number: number | null;
  archived: number;
  p_position: number | null;
  p_finished: number | null;
  p_updated: number | null;
  p_speed: number | null;
}

interface EpisodeWithShowRow extends EpisodeRow {
  podcast_title: string;
  podcast_cover_hash: string | null;
  speed: number;
}

const EPISODE_COLUMNS = `e.*,
  EXISTS (SELECT 1 FROM episode_archives a WHERE a.user_id = s.user_id AND a.episode_id = e.id) AS archived,
  pr.position_sec AS p_position, pr.finished AS p_finished, pr.updated_at AS p_updated, pr.speed AS p_speed`;

const EPISODE_WITH_SHOW_COLUMNS = `${EPISODE_COLUMNS},
  p.title AS podcast_title, p.cover_hash AS podcast_cover_hash, s.speed`;

// Every episode query goes through the user's subscription, which doubles as the access check.
const EPISODE_JOINS = `
  JOIN subscriptions s ON s.podcast_id = e.podcast_id AND s.user_id = ?
  JOIN podcasts p ON p.id = e.podcast_id
  LEFT JOIN progress pr ON pr.user_id = s.user_id AND pr.item_type = 'episode' AND pr.item_id = e.id`;

function toEpisode(e: EpisodeRow): EpisodeDto {
  return {
    id: e.id,
    podcastId: e.podcast_id,
    title: e.title,
    description: e.description,
    publishedAt: e.published_at,
    durationSec: e.duration_sec,
    audioUrl: e.audio_url,
    archived: e.archived === 1,
    imageUrl: e.image_url,
    season: e.season,
    episodeNumber: e.episode_number,
    progress:
      e.p_updated === null
        ? null
        : { positionSec: e.p_position ?? 0, finished: e.p_finished === 1, speed: e.p_speed ?? 1, updatedAt: e.p_updated },
  };
}

async function withShow(rows: EpisodeWithShowRow[]): Promise<EpisodeWithShow[]> {
  const colors = await coverColors(env.coversDir, rows.map((r) => r.podcast_cover_hash));
  return rows.map((r) => ({
    ...toEpisode(r),
    podcastTitle: r.podcast_title,
    podcastCoverHash: r.podcast_cover_hash,
    podcastCoverColor: r.podcast_cover_hash ? (colors.get(r.podcast_cover_hash) ?? null) : null,
    speed: r.speed,
  }));
}

/** Enough notes for a list row's one-line preview. */
export const SHORT_NOTES = 200;

/**
 * Cuts episode notes down for lists, where a row shows one line. Show notes can run to
 * 20k characters each, so a long show's full list was megabytes; the row fetches the
 * full text from `GET /api/episodes/:id` when it's expanded.
 */
export function shortNotes<T extends EpisodeDto>(episodes: T[]): T[] {
  return episodes.map((e) =>
    e.description && e.description.length > SHORT_NOTES
      ? { ...e, description: e.description.slice(0, SHORT_NOTES), descriptionCut: true }
      : e,
  );
}

export function listEpisodes(sqlite: Sqlite, podcastId: string, userId: number): EpisodeDto[] {
  const rows = sqlite
    .prepare(`SELECT ${EPISODE_COLUMNS} FROM episodes e ${EPISODE_JOINS} WHERE e.podcast_id = ? ORDER BY e.published_at DESC`)
    .all(userId, podcastId) as EpisodeRow[];
  return rows.map(toEpisode);
}

/** Newest unplayed, unarchived episodes across every show the user follows. */
export function listNewEpisodes(sqlite: Sqlite, userId: number, limit: number): Promise<EpisodeWithShow[]> {
  const rows = sqlite
    .prepare(
      `SELECT ${EPISODE_WITH_SHOW_COLUMNS} FROM episodes e ${EPISODE_JOINS}
       WHERE ${IS_NEW} AND NOT (${IS_STARTED}) ORDER BY e.published_at DESC LIMIT ?`,
    )
    .all(userId, limit) as EpisodeWithShowRow[];
  return withShow(rows);
}

/** Started, unfinished episodes, most recently listened first. */
export function listContinueEpisodes(sqlite: Sqlite, userId: number, limit: number): Promise<EpisodeWithShow[]> {
  const rows = sqlite
    .prepare(
      `SELECT ${EPISODE_WITH_SHOW_COLUMNS} FROM episodes e ${EPISODE_JOINS}
       WHERE ${IS_STARTED} ORDER BY pr.updated_at DESC LIMIT ?`,
    )
    .all(userId, limit) as EpisodeWithShowRow[];
  return withShow(rows);
}

export async function episodesByIds(sqlite: Sqlite, ids: string[], userId: number): Promise<EpisodeWithShow[]> {
  if (ids.length === 0) return [];
  const rows = sqlite
    .prepare(
      `SELECT ${EPISODE_WITH_SHOW_COLUMNS} FROM episodes e ${EPISODE_JOINS}
       WHERE e.id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(userId, ...ids) as EpisodeWithShowRow[];
  return withShow(rows);
}

/** An episode's audio location, if the user is subscribed to its podcast. */
export function getEpisodeForUser(sqlite: Sqlite, episodeId: string, userId: number) {
  return sqlite
    .prepare(
      `SELECT e.audio_url AS audioUrl, e.mime_type AS mimeType
       FROM episodes e JOIN subscriptions s ON s.podcast_id = e.podcast_id AND s.user_id = ?
       WHERE e.id = ?`,
    )
    .get(userId, episodeId) as { audioUrl: string; mimeType: string | null } | undefined;
}

export function subscribedFeeds(sqlite: Sqlite, userId: number) {
  return sqlite
    .prepare(
      `SELECT p.title, p.feed_url AS feedUrl FROM podcasts p
       JOIN subscriptions s ON s.podcast_id = p.id AND s.user_id = ? ORDER BY p.title`,
    )
    .all(userId) as Array<{ title: string; feedUrl: string }>;
}

export function isSubscribed(sqlite: Sqlite, podcastId: string, userId: number): boolean {
  return !!sqlite.prepare("SELECT 1 FROM subscriptions WHERE podcast_id = ? AND user_id = ?").get(podcastId, userId);
}
