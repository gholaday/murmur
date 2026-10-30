import crypto from "node:crypto";
import type { Sqlite } from "../db";
import { HttpError } from "../http";
import { storeCover } from "../library/covers";
import { createLimiter } from "../library/probe";
import { errorMessage, type Logger } from "../log";
import { readCapped, safeFetch } from "../safe-fetch";
import { FeedParseError, parseFeed, type ParsedFeed } from "./feed";

interface Deps {
  sqlite: Sqlite;
  coversDir: string;
  feedCheckMs: number;
  version: string;
  log: Logger;
  /** Called once a feed nobody follows is deleted, so its cached audio goes too. */
  onPodcastRemoved?: (podcastId: string) => void;
  /** Called after a feed's episodes are saved, not awaited (the newest episodes' chapters are looked up). */
  onFeedSaved?: (podcastId: string) => void;
}

const FEED_TIMEOUT_MS = 15_000;
const MAX_FEED_BYTES = 25 * 1024 * 1024;
const MAX_ARTWORK_BYTES = 20 * 1024 * 1024;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
const PREVIEW_CACHE_MS = 10 * 60_000;

const newId = () => crypto.randomBytes(9).toString("base64url");
const feedHost = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "?";
  }
};

type FetchResult = { kind: "not-modified" } | { kind: "ok"; feed: ParsedFeed; etag: string | null; lastModified: string | null };

interface PodcastRow {
  id: string;
  feed_url: string;
  etag: string | null;
  last_modified: string | null;
  image_url: string | null;
  cover_hash: string | null;
  failure_count: number;
  last_checked_at: number | null;
}

export function createPodcastService(deps: Deps) {
  const { sqlite, log } = deps;
  const feedLimit = createLimiter(3);
  const refreshing = new Map<string, Promise<void>>();
  const previews = new Map<string, { at: number; feed: ParsedFeed }>();

  async function fetchFeed(url: string, etag: string | null, lastModified: string | null): Promise<FetchResult> {
    const headers: Record<string, string> = {
      "User-Agent": `Murmur/${deps.version} (self-hosted podcast player)`,
      Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
    };
    if (etag) headers["If-None-Match"] = etag;
    if (lastModified) headers["If-Modified-Since"] = lastModified;
    const res = await safeFetch(url, { headers, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
    if (res.status === 304) return { kind: "not-modified" };
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`Feed server answered ${res.status}`);
    }
    const xml = (await readCapped(res, MAX_FEED_BYTES, "The feed")).toString("utf8");
    return { kind: "ok", feed: parseFeed(xml), etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified") };
  }

  async function cacheArtwork(podcastId: string, imageUrl: string | null, currentHash: string | null) {
    if (!imageUrl) return;
    try {
      const res = await safeFetch(imageUrl, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error(`image request answered ${res.status}`);
      }
      const hash = await storeCover(deps.coversDir, await readCapped(res, MAX_ARTWORK_BYTES, "The artwork"));
      if (hash !== currentHash) sqlite.prepare("UPDATE podcasts SET cover_hash = ? WHERE id = ?").run(hash, podcastId);
    } catch (err) {
      log.warn("podcast artwork not cached", { podcastId, error: errorMessage(err) });
    }
  }

  const upsertEpisode = () =>
    sqlite.prepare(`
      INSERT INTO episodes (id, podcast_id, guid, title, description, published_at, duration_sec, audio_url,
                            mime_type, size_bytes, image_url, season, episode_number, first_seen_at, chapters_url, chapters)
      VALUES (@id, @podcastId, @guid, @title, @description, @publishedAt, @durationSec, @audioUrl,
              @mimeType, @sizeBytes, @imageUrl, @season, @episodeNumber, @now, @chaptersUrl, @chapters)
      ON CONFLICT (podcast_id, guid) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        published_at = excluded.published_at,
        duration_sec = COALESCE(excluded.duration_sec, episodes.duration_sec),
        audio_url = excluded.audio_url,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        image_url = excluded.image_url,
        season = excluded.season,
        episode_number = excluded.episode_number,
        chapters_url = excluded.chapters_url,
        -- Chapters written in the feed win. Otherwise what was found stays, unless the chapters
        -- file or the audio changed, which means looking again.
        chapters = CASE
          WHEN excluded.chapters IS NOT NULL THEN excluded.chapters
          WHEN episodes.chapters_url IS NOT excluded.chapters_url OR episodes.audio_url IS NOT excluded.audio_url THEN NULL
          ELSE episodes.chapters END
      -- Most of a feed is unchanged on each check; skipping those rows saves rewriting them.
      WHERE episodes.title IS NOT excluded.title
        OR episodes.description IS NOT excluded.description
        OR episodes.published_at IS NOT excluded.published_at
        OR (excluded.duration_sec IS NOT NULL AND episodes.duration_sec IS NOT excluded.duration_sec)
        OR episodes.audio_url IS NOT excluded.audio_url
        OR episodes.mime_type IS NOT excluded.mime_type
        OR episodes.size_bytes IS NOT excluded.size_bytes
        OR episodes.image_url IS NOT excluded.image_url
        OR episodes.season IS NOT excluded.season
        OR episodes.episode_number IS NOT excluded.episode_number
        OR episodes.chapters_url IS NOT excluded.chapters_url
        OR (excluded.chapters IS NOT NULL AND episodes.chapters IS NOT excluded.chapters)`);

  /** Writes the feed's channel fields and episodes. Episodes that drop out of a feed are kept. */
  function saveFeed(podcastId: string, feed: ParsedFeed, etag: string | null, lastModified: string | null) {
    const now = Date.now();
    const upsert = upsertEpisode();
    sqlite.transaction(() => {
      sqlite
        .prepare(`UPDATE podcasts SET title = ?, author = ?, description = ?, link = ?, image_url = ?, etag = ?,
                  last_modified = ?, last_checked_at = ?, last_success_at = ?, last_error = NULL, failure_count = 0
                  WHERE id = ?`)
        .run(feed.title, feed.author, feed.description, feed.link, feed.imageUrl, etag, lastModified, now, now, podcastId);
      for (const e of feed.episodes) {
        upsert.run({ id: newId(), podcastId, now, ...e });
      }
    })();
    deps.onFeedSaved?.(podcastId);
  }

  function getRow(podcastId: string): PodcastRow | undefined {
    return sqlite.prepare("SELECT * FROM podcasts WHERE id = ?").get(podcastId) as PodcastRow | undefined;
  }

  async function refreshNow(podcastId: string): Promise<void> {
    const row = getRow(podcastId);
    if (!row) return;
    try {
      const result = await fetchFeed(row.feed_url, row.etag, row.last_modified);
      if (result.kind === "not-modified") {
        sqlite
          .prepare("UPDATE podcasts SET last_checked_at = ?, last_success_at = ?, last_error = NULL, failure_count = 0 WHERE id = ?")
          .run(Date.now(), Date.now(), podcastId);
        // A cover that failed to download (say, the network dropped while subscribing) gets
        // another try on each check, even when the feed itself hasn't changed.
        if (!row.cover_hash) await cacheArtwork(podcastId, row.image_url, null);
      } else {
        saveFeed(podcastId, result.feed, result.etag, result.lastModified);
        if (result.feed.imageUrl !== row.image_url || !row.cover_hash) {
          await cacheArtwork(podcastId, result.feed.imageUrl, row.cover_hash);
        }
      }
    } catch (err) {
      const message = errorMessage(err);
      sqlite
        .prepare("UPDATE podcasts SET last_checked_at = ?, last_error = ?, failure_count = failure_count + 1 WHERE id = ?")
        .run(Date.now(), message, podcastId);
      // The host only: private feeds carry the subscriber's token in the URL, which doesn't belong in a log.
      log.warn("feed check failed", { podcastId, host: feedHost(row.feed_url), error: message, failures: row.failure_count + 1 });
    }
  }

  /** Refreshes one feed; concurrent calls for the same feed share one request. */
  function refresh(podcastId: string): Promise<void> {
    const running = refreshing.get(podcastId);
    if (running) return running;
    const p = feedLimit(() => refreshNow(podcastId)).finally(() => refreshing.delete(podcastId));
    refreshing.set(podcastId, p);
    return p;
  }

  /** Checks every feed that is due. A failing feed waits longer each time, up to a day. */
  async function checkDue(): Promise<void> {
    const now = Date.now();
    const rows = sqlite.prepare("SELECT id, last_checked_at, failure_count FROM podcasts").all() as PodcastRow[];
    const due = rows.filter((r) => {
      if (r.last_checked_at === null) return true;
      const wait = Math.min(deps.feedCheckMs * 2 ** Math.min(r.failure_count, 6), MAX_BACKOFF_MS);
      return now - r.last_checked_at >= wait;
    });
    await Promise.all(due.map((r) => refresh(r.id)));
  }

  async function subscribe(userId: number, feedUrl: string): Promise<{ podcastId: string; created: boolean }> {
    const url = feedUrl.trim();
    let row = sqlite.prepare("SELECT id FROM podcasts WHERE feed_url = ?").get(url) as { id: string } | undefined;
    if (!row) {
      let result: FetchResult;
      const previewed = previews.get(url);
      if (previewed && Date.now() - previewed.at < PREVIEW_CACHE_MS) {
        result = { kind: "ok", feed: previewed.feed, etag: null, lastModified: null };
      } else {
        try {
          result = await fetchFeed(url, null, null);
        } catch (err) {
          const reason = err instanceof FeedParseError ? err.message : `Couldn't load the feed: ${errorMessage(err)}`;
          throw new HttpError(400, reason);
        }
      }
      if (result.kind !== "ok") throw new HttpError(400, "The feed returned no content.");
      const id = newId();
      // Re-check inside the transaction in case another request added the same feed meanwhile.
      const existing = sqlite.transaction(() => {
        const again = sqlite.prepare("SELECT id FROM podcasts WHERE feed_url = ?").get(url) as { id: string } | undefined;
        if (again) return again;
        sqlite
          .prepare("INSERT INTO podcasts (id, feed_url, title, created_at) VALUES (?, ?, ?, ?)")
          .run(id, url, result.feed.title, Date.now());
        return undefined;
      })();
      if (existing) row = existing;
      else {
        saveFeed(id, result.feed, result.etag, result.lastModified);
        await cacheArtwork(id, result.feed.imageUrl, null);
        row = { id };
      }
    }
    const info = sqlite
      .prepare("INSERT OR IGNORE INTO subscriptions (user_id, podcast_id, created_at) VALUES (?, ?, ?)")
      .run(userId, row.id, Date.now());
    return { podcastId: row.id, created: info.changes > 0 };
  }

  /**
   * Reads a feed without saving it, for a look before subscribing. Cached briefly so
   * opening the same result again, or subscribing right after, doesn't refetch twice.
   */
  async function preview(feedUrl: string): Promise<ParsedFeed> {
    const url = feedUrl.trim();
    const hit = previews.get(url);
    if (hit && Date.now() - hit.at < PREVIEW_CACHE_MS) return hit.feed;
    let result: FetchResult;
    try {
      result = await feedLimit(() => fetchFeed(url, null, null));
    } catch (err) {
      const reason = err instanceof FeedParseError ? err.message : `Couldn't load the feed: ${errorMessage(err)}`;
      throw new HttpError(400, reason);
    }
    if (result.kind !== "ok") throw new HttpError(400, "The feed returned no content.");
    previews.set(url, { at: Date.now(), feed: result.feed });
    // A big feed parses to many megabytes of episode notes, so keep only a handful.
    if (previews.size > 8) previews.delete(previews.keys().next().value!);
    return result.feed;
  }

  /** Removes the user's subscription; a feed nobody follows any more is deleted. */
  function unsubscribe(userId: number, podcastId: string) {
    sqlite.prepare("DELETE FROM subscriptions WHERE user_id = ? AND podcast_id = ?").run(userId, podcastId);
    const left = sqlite.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE podcast_id = ?").get(podcastId) as { n: number };
    if (left.n === 0) {
      sqlite.prepare("DELETE FROM podcasts WHERE id = ?").run(podcastId);
      deps.onPodcastRemoved?.(podcastId);
      log.info("podcast removed, no subscribers left", { podcastId });
    }
  }

  return { subscribe, unsubscribe, refresh, checkDue, preview };
}

export type PodcastService = ReturnType<typeof createPodcastService>;

/** Checks due feeds shortly after start, then every five minutes, running `after` once each round ends. */
export function startFeedScheduler(service: PodcastService, log: Logger, after?: () => Promise<void>) {
  const tick = () =>
    service
      .checkDue()
      .catch((err) => log.error("feed check round failed", { error: errorMessage(err) }))
      .then(() => after?.());
  const first = setTimeout(tick, 30_000);
  const every = setInterval(tick, 5 * 60_000);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
