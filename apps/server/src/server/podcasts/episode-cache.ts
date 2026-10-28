import fs from "node:fs";
import path from "node:path";
import type { Sqlite } from "../db";
import { errorMessage, type Logger } from "../log";
import { getServerSettings } from "../settings";
import { WAITING_EPISODES_SQL } from "../waiting-episodes";
import { audioExtension, evictionOrder } from "./cache-rules";

interface Deps {
  sqlite: Sqlite;
  dir: string;
  maxBytes: number;
  version: string;
  log: Logger;
  /** Called when a file finishes downloading, so ad detection can queue it. */
  onReady: (fileId: number) => void;
}

/** A download stops if no bytes arrive for this long. */
const STALL_MS = 60_000;
/** On-demand playback waits this long for the download to start before relaying instead. */
const START_WAIT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 30 * 60_000;

interface EpisodeRow {
  id: string;
  podcast_id: string;
  audio_url: string;
  mime_type: string | null;
}

interface FileRow {
  id: number;
  episode_id: string;
  rel_path: string;
  mime_type: string;
  size: number | null;
  status: "downloading" | "ready" | "failed";
  attempts: number;
  created_at: number;
  ready_at: number | null;
  last_played_at: number | null;
}

/** A download in progress, which streams can read from while it grows. */
export class Download {
  size: number | null = null;
  done = 0;
  finished = false;
  failed: string | null = null;
  private waiters = new Set<() => void>();
  /** Resolves true once the download has started and its size is known, false otherwise. */
  readonly started: Promise<boolean>;
  resolveStarted!: (ok: boolean) => void;

  constructor(
    readonly episodeId: string,
    readonly file: string,
    readonly mimeType: string,
  ) {
    this.started = new Promise((resolve) => (this.resolveStarted = resolve));
  }

  notify() {
    for (const w of this.waiters) w();
    this.waiters.clear();
  }

  /** Waits for more bytes, the end, or `ms`, whichever comes first. */
  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.waiters.delete(done);
        resolve();
      }, ms);
      this.waiters.add(done);
    });
  }
}

export type CachedAudio =
  | { kind: "ready"; file: string; mimeType: string }
  | { kind: "growing"; download: Download; file: string; mimeType: string };

export function createEpisodeCache(deps: Deps) {
  const { sqlite, log } = deps;
  const active = new Map<string, Download>();
  let available = false;
  let problem: string | null = "Not started yet.";
  let prefetching = false;

  const fullPath = (relPath: string) => path.join(deps.dir, ...relPath.split("/"));

  /** Checks the folder can be written, and tidies what an earlier run left behind. */
  function init() {
    try {
      fs.mkdirSync(deps.dir, { recursive: true });
      const probe = path.join(deps.dir, ".write-test");
      fs.writeFileSync(probe, "");
      fs.rmSync(probe);
      available = true;
      problem = null;
    } catch (err) {
      available = false;
      problem = `The episode cache folder can't be written (${errorMessage(err)}). Episodes are relayed from the publisher instead.`;
      log.warn("episode cache unavailable", { dir: deps.dir, error: errorMessage(err) });
      return;
    }
    // Downloads cut off by a restart start over; files without a row, or rows without a file, go.
    const rows = sqlite.prepare("SELECT * FROM episode_files").all() as FileRow[];
    const known = new Set<string>();
    for (const r of rows) {
      if (r.status === "downloading") {
        sqlite.prepare("UPDATE episode_files SET status = 'failed', error = 'Interrupted by a restart.' WHERE id = ?").run(r.id);
        fs.rmSync(fullPath(r.rel_path), { force: true });
      } else if (r.status === "ready" && !fs.existsSync(fullPath(r.rel_path))) {
        sqlite.prepare("DELETE FROM episode_files WHERE id = ?").run(r.id);
      } else if (r.status === "ready") {
        known.add(path.normalize(fullPath(r.rel_path)));
      }
    }
    let removed = 0;
    for (const show of safeReaddir(deps.dir)) {
      const showDir = path.join(deps.dir, show);
      if (!fs.statSync(showDir).isDirectory()) continue;
      for (const name of safeReaddir(showDir)) {
        const file = path.join(showDir, name);
        // Only files are episodes; a folder here is someone else's (Watch keeps its streams under /cache/watch).
        if (fs.statSync(file).isDirectory()) continue;
        if (!known.has(path.normalize(file))) {
          fs.rmSync(file, { force: true });
          removed++;
        }
      }
      if (safeReaddir(showDir).length === 0) fs.rmSync(showDir, { recursive: true, force: true });
    }
    if (removed) log.info("removed stray cached episodes", { count: removed });
  }

  function fileRow(episodeId: string): FileRow | undefined {
    return sqlite.prepare("SELECT * FROM episode_files WHERE episode_id = ?").get(episodeId) as FileRow | undefined;
  }

  /** Starts downloading an episode (or returns the download already running). */
  function start(episodeId: string): Download | null {
    const running = active.get(episodeId);
    if (running) return running;
    const ep = sqlite.prepare("SELECT id, podcast_id, audio_url, mime_type FROM episodes WHERE id = ?").get(episodeId) as
      | EpisodeRow
      | undefined;
    if (!ep) return null;
    const relPath = `${ep.podcast_id}/${ep.id}.${audioExtension(ep.mime_type, ep.audio_url)}`;
    const mimeType = ep.mime_type ?? "audio/mpeg";
    const now = Date.now();
    sqlite
      .prepare(
        `INSERT INTO episode_files (episode_id, rel_path, mime_type, status, attempts, created_at)
         VALUES (?, ?, ?, 'downloading', 1, ?)
         ON CONFLICT (episode_id) DO UPDATE SET rel_path = excluded.rel_path, mime_type = excluded.mime_type,
           status = 'downloading', attempts = episode_files.attempts + 1, error = NULL, size = NULL,
           created_at = excluded.created_at, ready_at = NULL`,
      )
      .run(ep.id, relPath, mimeType, now);
    const dl = new Download(ep.id, fullPath(relPath), mimeType);
    active.set(ep.id, dl);
    void run(ep, dl).finally(() => active.delete(ep.id));
    return dl;
  }

  async function run(ep: EpisodeRow, dl: Download) {
    const controller = new AbortController();
    let stall = setTimeout(() => controller.abort(), STALL_MS);
    const kick = () => {
      clearTimeout(stall);
      stall = setTimeout(() => controller.abort(), STALL_MS);
    };
    let handle: fs.promises.FileHandle | null = null;
    try {
      const res = await fetch(ep.audio_url, {
        headers: { "User-Agent": `Murmur/${deps.version}`, "Accept-Encoding": "identity" },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`The audio host answered ${res.status}.`);
      const length = Number(res.headers.get("content-length"));
      dl.size = Number.isFinite(length) && length > 0 && !res.headers.get("content-encoding") ? length : null;
      if (dl.size) sqlite.prepare("UPDATE episode_files SET size = ? WHERE episode_id = ?").run(dl.size, ep.id);
      fs.mkdirSync(path.dirname(dl.file), { recursive: true });
      handle = await fs.promises.open(dl.file, "w");
      dl.resolveStarted(dl.size !== null);
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        kick();
        await handle.write(chunk);
        dl.done += chunk.length;
        dl.notify();
      }
      await handle.close();
      handle = null;
      if (dl.size !== null && dl.done !== dl.size) throw new Error("The download ended early.");
      dl.size = dl.done;
      sqlite
        .prepare("UPDATE episode_files SET status = 'ready', size = ?, ready_at = ?, error = NULL WHERE episode_id = ?")
        .run(dl.done, Date.now(), ep.id);
      dl.finished = true;
      dl.notify();
      log.info("episode cached", { episodeId: ep.id, mb: Math.round(dl.done / 1e5) / 10 });
      const row = fileRow(ep.id);
      if (row) deps.onReady(row.id);
      evict();
    } catch (err) {
      const message = controller.signal.aborted ? "The download stalled." : errorMessage(err);
      await handle?.close().catch(() => undefined);
      fs.rmSync(dl.file, { force: true });
      sqlite.prepare("UPDATE episode_files SET status = 'failed', error = ? WHERE episode_id = ?").run(message, ep.id);
      dl.failed = message;
      dl.resolveStarted(false);
      dl.notify();
      log.warn("episode download failed", { episodeId: ep.id, error: message });
    } finally {
      clearTimeout(stall);
    }
  }

  /**
   * The server's copy of an episode for playing, starting the download if needed. Null means
   * relay from the publisher: no cache, or the download couldn't start with a known size.
   */
  async function open(episodeId: string): Promise<CachedAudio | null> {
    if (!available) return null;
    const row = fileRow(episodeId);
    if (row?.status === "ready") {
      const file = fullPath(row.rel_path);
      if (fs.existsSync(file)) {
        if (!row.last_played_at || Date.now() - row.last_played_at > 60_000) {
          sqlite.prepare("UPDATE episode_files SET last_played_at = ? WHERE id = ?").run(Date.now(), row.id);
        }
        return { kind: "ready", file, mimeType: row.mime_type };
      }
      sqlite.prepare("DELETE FROM episode_files WHERE id = ?").run(row.id);
    }
    const dl = start(episodeId);
    if (!dl) return null;
    const ok = await Promise.race([dl.started, new Promise<boolean>((r) => setTimeout(() => r(false), START_WAIT_MS))]);
    if (!ok || dl.failed) return null;
    if (dl.finished) return { kind: "ready", file: dl.file, mimeType: dl.mimeType };
    return { kind: "growing", download: dl, file: dl.file, mimeType: dl.mimeType };
  }

  /** Episodes in anyone's Up Next, then the newest of each followed show that someone still might play. */
  function wanted(perShow: number): string[] {
    const upNext = sqlite
      .prepare(
        `SELECT w.id FROM (${WAITING_EPISODES_SQL}) w JOIN episodes e ON e.id = w.id`,
      )
      .all() as Array<{ id: string }>;
    const newest = sqlite
      .prepare(
        `WITH ranked AS (
           SELECT e.id, e.podcast_id, e.published_at,
             ROW_NUMBER() OVER (PARTITION BY e.podcast_id ORDER BY e.published_at DESC) AS rn
           FROM episodes e WHERE EXISTS (SELECT 1 FROM subscriptions s WHERE s.podcast_id = e.podcast_id))
         SELECT r.id FROM ranked r
         WHERE r.rn <= ? AND EXISTS (
           SELECT 1 FROM subscriptions s WHERE s.podcast_id = r.podcast_id
             AND NOT EXISTS (SELECT 1 FROM progress pr WHERE pr.user_id = s.user_id AND pr.item_type = 'episode'
                             AND pr.item_id = r.id AND pr.finished = 1)
             AND NOT EXISTS (SELECT 1 FROM episode_archives a WHERE a.user_id = s.user_id AND a.episode_id = r.id))
         ORDER BY r.published_at DESC`,
      )
      .all(perShow) as Array<{ id: string }>;
    return [...new Set([...upNext, ...newest].map((r) => r.id))];
  }

  /** Downloads what's wanted and missing, one at a time. Runs after each round of feed checks. */
  async function prefetch() {
    if (!available || prefetching) return;
    const perShow = getServerSettings(sqlite).episodesPerShow;
    if (perShow === 0) return;
    prefetching = true;
    try {
      for (const id of wanted(perShow)) {
        const row = fileRow(id);
        if (row && row.status !== "failed") continue;
        if (row && (row.attempts >= MAX_ATTEMPTS || Date.now() - row.created_at < RETRY_AFTER_MS * row.attempts)) continue;
        const dl = start(id);
        if (!dl) continue;
        while (!dl.finished && !dl.failed) await dl.wait(10_000);
        if (usedBytes() > deps.maxBytes) break; // full of things we must keep
      }
    } catch (err) {
      log.error("prefetch failed", { error: errorMessage(err) });
    } finally {
      prefetching = false;
    }
  }

  function usedBytes(): number {
    return (sqlite.prepare("SELECT COALESCE(SUM(size), 0) AS n FROM episode_files WHERE status = 'ready'").get() as { n: number }).n;
  }

  function remove(fileId: number, relPath: string) {
    fs.rmSync(fullPath(relPath), { force: true });
    sqlite.prepare("DELETE FROM episode_files WHERE id = ?").run(fileId); // ad times go with it
  }

  /** Removes episodes until the cache is under its cap; see `evictionOrder` for which. */
  function evict() {
    let total = usedBytes();
    if (total <= deps.maxBytes) return;
    const rows = sqlite.prepare("SELECT * FROM episode_files WHERE status = 'ready'").all() as FileRow[];
    const perShow = getServerSettings(sqlite).episodesPerShow;
    const keep = new Set<string>(active.keys());
    const ids = (sql: string, ...args: unknown[]) => (sqlite.prepare(sql).all(...args) as Array<{ id: string }>).map((r) => r.id);
    for (const id of ids(WAITING_EPISODES_SQL)) keep.add(id);
    for (const id of ids("SELECT item_id AS id FROM progress WHERE item_type = 'episode' AND finished = 0 AND position_sec > 5")) keep.add(id);
    for (const id of ids(
      `SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY podcast_id ORDER BY published_at DESC) AS rn FROM episodes) WHERE rn <= ?`,
      perShow,
    ))
      keep.add(id);
    const finishedByAll = new Set(
      ids(
        `SELECT f.episode_id AS id FROM episode_files f JOIN episodes e ON e.id = f.episode_id
         WHERE NOT EXISTS (
           SELECT 1 FROM subscriptions s WHERE s.podcast_id = e.podcast_id
             AND NOT EXISTS (SELECT 1 FROM progress pr WHERE pr.user_id = s.user_id AND pr.item_type = 'episode'
                             AND pr.item_id = e.id AND pr.finished = 1)
             AND NOT EXISTS (SELECT 1 FROM episode_archives a WHERE a.user_id = s.user_id AND a.episode_id = e.id))`,
      ),
    );
    const byEpisode = new Map(rows.map((r) => [r.episode_id, r]));
    const order = evictionOrder(
      rows.map((r) => ({ episodeId: r.episode_id, size: r.size ?? 0, lastUsedAt: r.last_played_at ?? r.ready_at ?? r.created_at })),
      keep,
      finishedByAll,
    );
    let count = 0;
    for (const f of order) {
      if (total <= deps.maxBytes) break;
      const row = byEpisode.get(f.episodeId)!;
      remove(row.id, row.rel_path);
      total -= f.size;
      count++;
    }
    if (count) log.info("episode cache trimmed", { removed: count, usedMb: Math.round(total / 1e6) });
  }

  function status() {
    const counts = sqlite
      .prepare("SELECT status, COUNT(*) AS n FROM episode_files GROUP BY status")
      .all() as Array<{ status: string; n: number }>;
    const n = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
    return { available, error: problem, usedBytes: usedBytes(), maxBytes: deps.maxBytes, episodes: n("ready"), downloading: active.size };
  }

  return { init, open, prefetch, status, available: () => available };
}

export type EpisodeCache = ReturnType<typeof createEpisodeCache>;

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
