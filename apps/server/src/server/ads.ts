import crypto from "node:crypto";
import { type AddonJob, type AddonReport, type AddonStatus, type AdSpan, cameThroughProxy, type EpisodeAdsDto } from "@murmur/shared";
import type { Sqlite } from "./db";
import { env } from "./env";
import { HttpError } from "./http";
import { cleanAdSpans } from "./podcasts/cache-rules";
import { readState, writeState } from "./settings";
import { WAITING_EPISODES_SQL } from "./waiting-episodes";

/** A scan handed out is the add-on's for this long; after that it goes back in the queue. */
const LEASE_MS = 30 * 60_000;
const MAX_ATTEMPTS = 3;
/** Someone played the episode this recently, so it jumps the queue. */
const WANTED_MS = 10 * 60_000;

export const adsEnabled = () => env.addonSecret.length > 0;

/**
 * Checks the add-on's shared secret. Without ADDON_SECRET the endpoints don't exist, and they never
 * answer anything that came through a proxy or tunnel, whatever the secret. Next fills in the
 * `x-forwarded-*` headers itself when they're missing, so only those it leaves alone are checked.
 */
export function requireAddon(req: Request) {
  if (!adsEnabled() || cameThroughProxy((name) => req.headers.get(name))) throw new HttpError(404, "Not found.");
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(env.addonSecret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, "Wrong add-on secret.");
}

export function queueScan(sqlite: Sqlite, fileId: number) {
  if (!adsEnabled()) return;
  sqlite
    .prepare("INSERT OR IGNORE INTO ad_scans (file_id, status, updated_at) VALUES (?, 'queued', ?)")
    .run(fileId, Date.now());
}

/** Queues every cached episode that has never been scanned, for when the add-on is added later. */
export function queueUnscanned(sqlite: Sqlite) {
  if (!adsEnabled()) return;
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO ad_scans (file_id, status, updated_at)
       SELECT id, 'queued', ? FROM episode_files WHERE status = 'ready'`,
    )
    .run(Date.now());
}

interface ScanRow {
  file_id: number;
  status: EpisodeAdsDto["status"];
  pieces_done: number;
  attempts: number;
  wanted_at: number | null;
}

/** An episode's ad times for the player. Asking also marks it as being played, which moves its scan up. */
export function episodeAds(sqlite: Sqlite, episodeId: string): EpisodeAdsDto {
  if (!adsEnabled()) return { enabled: false, status: "none", ads: [] };
  const scan = sqlite
    .prepare(
      `SELECT s.* FROM ad_scans s JOIN episode_files f ON f.id = s.file_id
       WHERE f.episode_id = ? AND f.status = 'ready'`,
    )
    .get(episodeId) as ScanRow | undefined;
  if (!scan) return { enabled: true, status: "none", ads: [] };
  const now = Date.now();
  if (scan.status !== "done" && (!scan.wanted_at || now - scan.wanted_at > 60_000)) {
    sqlite.prepare("UPDATE ad_scans SET wanted_at = ? WHERE file_id = ?").run(now, scan.file_id);
  }
  const ads = (
    sqlite
      .prepare("SELECT start_sec, end_sec, kind, advertiser, first_words FROM episode_ads WHERE file_id = ? ORDER BY start_sec")
      .all(scan.file_id) as Array<{ start_sec: number; end_sec: number; kind: string; advertiser: string | null; first_words: string | null }>
  ).map((a) => ({
    startSec: a.start_sec,
    endSec: a.end_sec,
    kind: a.kind as AdSpan["kind"],
    advertiser: a.advertiser,
    firstWords: a.first_words,
  }));
  return { enabled: true, status: scan.status, ads };
}

/**
 * Hands the add-on its next scan: something being played right now, then anything in
 * someone's Up Next, then the newest episodes.
 */
export function claimNext(sqlite: Sqlite): AddonJob | null {
  return sqlite.transaction(() => {
    const now = Date.now();
    const row = sqlite
      .prepare(
        `SELECT s.file_id, s.pieces_done, f.episode_id, f.rel_path, e.title, e.duration_sec, p.title AS podcast_title
         FROM ad_scans s
         JOIN episode_files f ON f.id = s.file_id AND f.status = 'ready'
         JOIN episodes e ON e.id = f.episode_id
         JOIN podcasts p ON p.id = e.podcast_id
         WHERE (s.status = 'queued' AND (s.not_before IS NULL OR s.not_before <= @now))
            OR (s.status = 'scanning' AND s.lease_until < @now)
         ORDER BY (s.wanted_at IS NOT NULL AND s.wanted_at > @wanted) DESC,
           e.id IN (${WAITING_EPISODES_SQL}) DESC,
           e.published_at DESC
         LIMIT 1`,
      )
      .get({ now, wanted: now - WANTED_MS }) as
      | { file_id: number; pieces_done: number; episode_id: string; rel_path: string; title: string; duration_sec: number | null; podcast_title: string }
      | undefined;
    if (!row) return null;
    sqlite
      .prepare("UPDATE ad_scans SET status = 'scanning', lease_until = ?, not_before = NULL, updated_at = ? WHERE file_id = ?")
      .run(now + LEASE_MS, now, row.file_id);
    return {
      fileId: row.file_id,
      episodeId: row.episode_id,
      path: row.rel_path,
      durationSec: row.duration_sec,
      title: row.title,
      podcastTitle: row.podcast_title,
      piecesDone: row.pieces_done,
    };
  })();
}

/** Takes the add-on's report on a scan. Ads replace what was stored, so a report can be resent safely. */
export function applyReport(sqlite: Sqlite, fileId: number, report: AddonReport) {
  const file = sqlite
    .prepare(
      `SELECT s.attempts, e.duration_sec FROM ad_scans s JOIN episode_files f ON f.id = s.file_id
       JOIN episodes e ON e.id = f.episode_id WHERE s.file_id = ?`,
    )
    .get(fileId) as { attempts: number; duration_sec: number | null } | undefined;
  if (!file) throw new HttpError(404, "No such scan; the episode may have left the cache.");
  const now = Date.now();
  sqlite.transaction(() => {
    if (report.status === "progress" || report.status === "done") {
      // Feed durations are often a little off, so only spans well past the end are dropped here;
      // the add-on knows the file's real length and cuts spans to it.
      const ads = cleanAdSpans(report.ads, file.duration_sec ? file.duration_sec + 60 : null);
      sqlite.prepare("DELETE FROM episode_ads WHERE file_id = ?").run(fileId);
      const insert = sqlite.prepare(
        "INSERT INTO episode_ads (file_id, start_sec, end_sec, kind, advertiser, first_words) VALUES (?, ?, ?, ?, ?, ?)",
      );
      for (const a of ads) insert.run(fileId, a.startSec, a.endSec, a.kind, a.advertiser ?? null, a.firstWords ?? null);
      if (report.status === "progress") {
        sqlite
          .prepare("UPDATE ad_scans SET status = 'scanning', pieces_done = ?, lease_until = ?, updated_at = ? WHERE file_id = ?")
          .run(report.piecesDone, now + LEASE_MS, now, fileId);
      } else {
        sqlite
          .prepare("UPDATE ad_scans SET status = 'done', pieces_done = ?, lease_until = NULL, last_error = NULL, updated_at = ? WHERE file_id = ?")
          .run(report.piecesDone, now, fileId);
      }
    } else if (report.status === "deferred") {
      sqlite
        .prepare("UPDATE ad_scans SET status = 'queued', lease_until = NULL, not_before = ?, last_error = ?, updated_at = ? WHERE file_id = ?")
        .run(now + report.retryAfterSec * 1000, report.reason, now, fileId);
    } else {
      const attempts = file.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      sqlite
        .prepare(
          `UPDATE ad_scans SET status = ?, attempts = ?, lease_until = NULL, not_before = ?, last_error = ?, updated_at = ?
           WHERE file_id = ?`,
        )
        .run(giveUp ? "failed" : "queued", attempts, giveUp ? null : now + 30 * 60_000 * attempts, report.error, now, fileId);
    }
  })();
}

/** Puts failed scans back in the queue, from the admin's Retry button. */
export function retryFailed(sqlite: Sqlite): number {
  return sqlite
    .prepare("UPDATE ad_scans SET status = 'queued', attempts = 0, not_before = NULL, updated_at = ? WHERE status = 'failed'")
    .run(Date.now()).changes;
}

export function saveAddonStatus(sqlite: Sqlite, { started, ...status }: AddonStatus) {
  // There's only one add-on, so after a restart nothing is really scanning; the next ask resumes it.
  if (started) sqlite.prepare("UPDATE ad_scans SET status = 'queued', lease_until = NULL WHERE status = 'scanning'").run();
  writeState(sqlite, "addon", { ...status, seenAt: Date.now() });
}

export function adsStatus(sqlite: Sqlite) {
  const counts = sqlite.prepare("SELECT status, COUNT(*) AS n FROM ad_scans GROUP BY status").all() as Array<{ status: string; n: number }>;
  const n = (...s: string[]) => counts.filter((c) => s.includes(c.status)).reduce((sum, c) => sum + c.n, 0);
  return {
    enabled: adsEnabled(),
    addon: readState<AddonStatus & { seenAt: number }>(sqlite, "addon"),
    queued: n("queued", "scanning"),
    done: n("done"),
    failed: n("failed"),
  };
}
