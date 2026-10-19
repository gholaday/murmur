import path from "node:path";

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return value;
}

const dataDir = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR ?? "./data");

export const env = {
  version: process.env.MURMUR_VERSION ?? "dev",
  /** Audible store used by Match: us, uk, ca, au, de, fr, it, es, in or jp. */
  audibleRegion: (process.env.AUDIBLE_REGION ?? "us").toLowerCase(),
  dataDir,
  dbPath: path.join(dataDir, "murmur.db"),
  coversDir: path.join(dataDir, "covers"),
  backupsDir: path.join(dataDir, "backups"),
  podcastsDir: path.join(dataDir, "podcasts"),
  /** How often each feed is checked when healthy; failing feeds back off up to 24 hours. */
  feedCheckMs: intEnv("FEED_CHECK_MINUTES", 60) * 60_000,
  libraryDir: path.resolve(/*turbopackIgnore: true*/ process.env.LIBRARY_DIR ?? "/audiobooks"),
  migrationsDir: path.resolve(/*turbopackIgnore: true*/ process.env.MIGRATIONS_DIR ?? "./drizzle"),
  /** Use polling instead of filesystem events (for network mounts that don't emit events). */
  watchPolling: process.env.WATCH_POLLING === "true",
  /** Quiet period after the last file change before a rescan starts. */
  watchDebounceMs: intEnv("WATCH_DEBOUNCE_SECONDS", 30) * 1000,
  /** Safety-net rescan interval even when the watcher is working. */
  periodicScanMs: intEnv("PERIODIC_SCAN_MINUTES", 360) * 60_000,
  /** Hour of day (local time, 0-23) for the nightly database backup. */
  backupHour: intEnv("BACKUP_HOUR", 3),
  backupKeep: intEnv("BACKUP_KEEP", 7),
  /** Books whose folder is gone stay visible (marked missing) for this long before being hidden. */
  missingGraceMs: intEnv("MISSING_GRACE_DAYS", 7) * 86_400_000,
  probeConcurrency: intEnv("PROBE_CONCURRENCY", 2),
  ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
};
