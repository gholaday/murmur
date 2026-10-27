import path from "node:path";
import pkg from "../../package.json";

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return value;
}

const dataDir = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR ?? "./data");

export const env = {
  /** Set by the Docker image. Without it (pnpm dev), the version in package.json. */
  version: process.env.MURMUR_VERSION ?? pkg.version,
  /** Not a released image: no MURMUR_VERSION, or the image's own "dev" default. */
  devBuild: !process.env.MURMUR_VERSION || process.env.MURMUR_VERSION === "dev",
  /** Ask GitHub every 6 hours whether a newer release is out, to tell admins in Settings. */
  updateCheck: process.env.UPDATE_CHECK !== "false",
  /** Audible store used by Match: us, uk, ca, au, de, fr, it, es, in or jp. */
  audibleRegion: (process.env.AUDIBLE_REGION ?? "us").toLowerCase(),
  /** Optional Google Books key for Match. Without one, Google shares a small quota per IP address. */
  googleBooksApiKey: process.env.GOOGLE_BOOKS_API_KEY?.trim() || null,
  dataDir,
  dbPath: path.join(dataDir, "murmur.db"),
  coversDir: path.join(dataDir, "covers"),
  backupsDir: path.join(dataDir, "backups"),
  /** How often each feed is checked when healthy; failing feeds back off up to 24 hours. */
  feedCheckMs: intEnv("FEED_CHECK_MINUTES", 30) * 60_000,
  libraryDir: path.resolve(/*turbopackIgnore: true*/ process.env.LIBRARY_DIR ?? "/audiobooks"),
  /** Added as the first music folder once something is mounted there; until then music stays off. */
  musicDir: path.resolve(/*turbopackIgnore: true*/ process.env.MUSIC_DIR ?? "/music"),
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
  /** Where podcast episodes are kept; without a writable folder, episodes are relayed instead. */
  episodeCacheDir: path.resolve(/*turbopackIgnore: true*/ process.env.EPISODE_CACHE_DIR ?? "/cache"),
  episodeCacheMaxBytes: intEnv("EPISODE_CACHE_MAX_GB", 20) * 1024 ** 3,
  /** Shared with the ad detection add-on; its endpoints are off unless this is set. */
  addonSecret: process.env.ADDON_SECRET ?? "",
};
