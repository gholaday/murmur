import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Sqlite } from "../db";
import { HttpError } from "../http";
import { storeCover } from "../library/covers";
import { createLimiter } from "../library/probe";
import { errorMessage, type Logger } from "../log";
import { FeedParseError, parseFeed, type ParsedFeed } from "./feed";

interface Deps {
  sqlite: Sqlite;
  podcastsDir: string;
  coversDir: string;
  feedCheckMs: number;
  version: string;
  log: Logger;
}

const FEED_TIMEOUT_MS = 15_000;
const MAX_FEED_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_STALL_MS = 60_000;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

const newId = () => crypto.randomBytes(9).toString("base64url");

type FetchResult = { kind: "not-modified" } | { kind: "ok"; feed: ParsedFeed; etag: string | null; lastModified: string | null };

interface PodcastRow {
  id: string;
  feed_url: string;
  etag: string | null;
  last_modified: string | null;
  image_url: string | null;
  cover_hash: string | null;
  auto_download: number;
  keep_latest: number;
  failure_count: number;
  last_checked_at: number | null;
}

export function createPodcastService(deps: Deps) {
  const { sqlite, log } = deps;
  const feedLimit = createLimiter(3);
  const downloadLimit = createLimiter(1);
  const refreshing = new Map<string, Promise<void>>();

  async function fetchFeed(url: string, etag: string | null, lastModified: string | null): Promise<FetchResult> {
    const headers: Record<string, string> = {
      "User-Agent": `Murmur/${deps.version} (self-hosted podcast player)`,
      Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
    };
    if (etag) headers["If-None-Match"] = etag;
    if (lastModified) headers["If-Modified-Since"] = lastModified;
    const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
    if (res.status === 304) return { kind: "not-modified" };
    if (!res.ok) throw new Error(`Feed server answered ${res.status} ${res.statusText}`);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_FEED_BYTES) throw new Error("Feed is too large.");
    const xml = await res.text();
    if (xml.length > MAX_FEED_BYTES) throw new Error("Feed is too large.");
    return { kind: "ok", feed: parseFeed(xml), etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified") };
  }

  async function cacheArtwork(podcastId: string, imageUrl: string | null, currentHash: string | null) {
    if (!imageUrl) return;
    try {
      const res = await fetch(imageUrl, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`image request answered ${res.status}`);
      const hash = await storeCover(deps.coversDir, Buffer.from(await res.arrayBuffer()));
      if (hash !== currentHash) sqlite.prepare("UPDATE podcasts SET cover_hash = ? WHERE id = ?").run(hash, podcastId);
    } catch (err) {
      log.warn("podcast artwork not cached", { podcastId, error: errorMessage(err) });
    }
  }

  const upsertEpisode = () =>
    sqlite.prepare(`
      INSERT INTO episodes (id, podcast_id, guid, title, description, published_at, duration_sec, audio_url,
                            mime_type, size_bytes, image_url, season, episode_number, first_seen_at)
      VALUES (@id, @podcastId, @guid, @title, @description, @publishedAt, @durationSec, @audioUrl,
              @mimeType, @sizeBytes, @imageUrl, @season, @episodeNumber, @now)
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
        episode_number = excluded.episode_number`);

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
      log.warn("feed check failed", { podcastId, feed: row.feed_url, error: message, failures: row.failure_count + 1 });
      return;
    }
    void syncDownloads(podcastId);
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
      try {
        result = await fetchFeed(url, null, null);
      } catch (err) {
        const reason = err instanceof FeedParseError ? err.message : `Couldn't load the feed: ${errorMessage(err)}`;
        throw new HttpError(400, reason);
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

  /** Removes the user's subscription; a feed nobody follows any more is deleted with its downloads. */
  function unsubscribe(userId: number, podcastId: string) {
    sqlite.prepare("DELETE FROM subscriptions WHERE user_id = ? AND podcast_id = ?").run(userId, podcastId);
    const left = sqlite.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE podcast_id = ?").get(podcastId) as { n: number };
    if (left.n === 0) {
      sqlite.prepare("DELETE FROM podcasts WHERE id = ?").run(podcastId);
      fs.rmSync(path.join(deps.podcastsDir, podcastId), { recursive: true, force: true });
      log.info("podcast removed, no subscribers left", { podcastId });
    }
  }

  function updateSettings(podcastId: string, settings: { autoDownload?: boolean; keepLatest?: number }) {
    const row = getRow(podcastId);
    if (!row) throw new HttpError(404, "Podcast not found.");
    sqlite
      .prepare("UPDATE podcasts SET auto_download = ?, keep_latest = ? WHERE id = ?")
      .run(
        (settings.autoDownload ?? row.auto_download === 1) ? 1 : 0,
        settings.keepLatest ?? row.keep_latest,
        podcastId,
      );
    void syncDownloads(podcastId);
  }

  // ---------- Downloads ----------

  function extensionFor(audioUrl: string, mimeType: string | null): string {
    const fromUrl = path.extname(new URL(audioUrl).pathname).toLowerCase();
    if ([".mp3", ".m4a", ".aac", ".ogg", ".opus", ".mp4"].includes(fromUrl)) return fromUrl;
    if (mimeType?.includes("mp4") || mimeType?.includes("m4a")) return ".m4a";
    if (mimeType?.includes("ogg")) return ".ogg";
    return ".mp3";
  }

  async function downloadEpisode(podcastId: string, ep: { id: string; audio_url: string; mime_type: string | null }) {
    const dir = path.join(deps.podcastsDir, podcastId);
    fs.mkdirSync(dir, { recursive: true });
    const name = `${ep.id}${extensionFor(ep.audio_url, ep.mime_type)}`;
    const target = path.join(dir, name);
    const tmp = `${target}.part`;
    const controller = new AbortController();
    let stall = setTimeout(() => controller.abort(new Error("download stalled")), DOWNLOAD_STALL_MS);
    try {
      const res = await fetch(ep.audio_url, {
        headers: { "User-Agent": `Murmur/${deps.version}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`audio request answered ${res.status}`);
      const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
      body.on("data", () => {
        clearTimeout(stall);
        stall = setTimeout(() => controller.abort(new Error("download stalled")), DOWNLOAD_STALL_MS);
      });
      await pipeline(body, fs.createWriteStream(tmp));
      fs.renameSync(tmp, target);
      sqlite
        .prepare("UPDATE episodes SET local_path = ?, downloaded_at = ? WHERE id = ?")
        .run(`${podcastId}/${name}`, Date.now(), ep.id);
      log.info("episode downloaded", { podcastId, episodeId: ep.id });
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      log.warn("episode download failed", { podcastId, episodeId: ep.id, error: errorMessage(err) });
    } finally {
      clearTimeout(stall);
    }
  }

  /** Keeps exactly the newest `keepLatest` episodes on the NAS for auto-download shows. */
  function syncDownloads(podcastId: string): Promise<void> {
    return downloadLimit(async () => {
      const row = getRow(podcastId);
      if (!row) return;
      const eps = sqlite
        .prepare("SELECT id, audio_url, mime_type, local_path FROM episodes WHERE podcast_id = ? ORDER BY published_at DESC")
        .all(podcastId) as Array<{ id: string; audio_url: string; mime_type: string | null; local_path: string | null }>;
      const keep = row.auto_download === 1 ? eps.slice(0, row.keep_latest) : [];
      const keepIds = new Set(keep.map((e) => e.id));
      for (const e of eps) {
        if (e.local_path && !keepIds.has(e.id)) {
          fs.rmSync(path.join(deps.podcastsDir, e.local_path), { force: true });
          sqlite.prepare("UPDATE episodes SET local_path = NULL, downloaded_at = NULL WHERE id = ?").run(e.id);
        }
      }
      for (const e of keep) {
        if (!e.local_path || !fs.existsSync(path.join(deps.podcastsDir, e.local_path))) await downloadEpisode(podcastId, e);
      }
    });
  }

  return { subscribe, unsubscribe, refresh, checkDue, updateSettings };
}

export type PodcastService = ReturnType<typeof createPodcastService>;

/** Checks due feeds shortly after start, then every five minutes. */
export function startFeedScheduler(service: PodcastService, log: Logger) {
  const tick = () => service.checkDue().catch((err) => log.error("feed check round failed", { error: errorMessage(err) }));
  const first = setTimeout(tick, 30_000);
  const every = setInterval(tick, 5 * 60_000);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
