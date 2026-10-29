import fs from "node:fs";
import path from "node:path";
import { backupDatabase, openDatabase, type Db, type Sqlite } from "./db";
import { env } from "./env";
import { ensureDefaultFolder, ensureMountedFolder, listFolders, saveFolders, type LibraryFolder } from "./library/folders";
import { createWatchScanner, type WatchScanner } from "./watch/scanner";
import { createWatchMatcher, type WatchMatcher } from "./watch/match";
import { createTmdb } from "./watch/tmdb";
import { setBusy } from "./changes";
import { pruneProviderCache } from "./metadata/providers";
import { fillArtistPhotos } from "./music/match";
import { createMusicScanner, type MusicScanner } from "./music/scanner";
import { createScanState, createScanner, type ScanState, type Scanner } from "./library/scanner";
import { startWatcher, type LibraryWatcher } from "./library/watcher";
import { createLogger, errorMessage, type Logger } from "./log";
import { queueScan, queueUnscanned } from "./ads";
import { createEpisodeCache, type EpisodeCache } from "./podcasts/episode-cache";
import { createPodcastService, startFeedScheduler, type PodcastService } from "./podcasts/service";
import { startUpdateChecks } from "./updates";

export interface AppContext {
  db: Db;
  sqlite: Sqlite;
  scanner: Scanner;
  scanState: ScanState;
  watcher: LibraryWatcher;
  library: {
    folders: () => LibraryFolder[];
    /** Replaces the folder list, restarts the watcher and starts a rescan. */
    saveFolders: (paths: string[]) => Promise<LibraryFolder[]>;
  };
  music: {
    scanner: MusicScanner;
    state: ScanState;
    folders: () => LibraryFolder[];
    /** Replaces the music folder list, restarts its watcher and starts a rescan. */
    saveFolders: (paths: string[]) => Promise<LibraryFolder[]>;
  };
  watch: {
    scanner: WatchScanner;
    state: ScanState;
    folders: () => { movies: LibraryFolder[]; shows: LibraryFolder[] };
    /** Replaces the movies or shows folder list, restarts their watcher and starts a rescan. */
    saveFolders: (kind: "movies" | "shows", paths: string[]) => Promise<void>;
    /** TMDB matching; null without a TMDB key. */
    matcher: WatchMatcher | null;
  };
  podcasts: PodcastService;
  episodeCache: EpisodeCache;
  startedAt: number;
}

const log = createLogger("boot");

// Next bundles instrumentation and each route separately, so module-level state is not
// shared between them. Everything long-lived hangs off globalThis instead.
declare global {
  var __murmur: { ready?: Promise<AppContext> } | undefined;
}

/** Returns the running app, starting it on first use. Safe to call from anywhere on the server. */
export function getContext(): Promise<AppContext> {
  globalThis.__murmur ??= {};
  const holder = globalThis.__murmur;
  holder.ready ??= boot().catch((err) => {
    holder.ready = undefined;
    log.error("startup failed", { error: errorMessage(err) });
    if (process.env.NODE_ENV === "production") {
      // Let Docker's restart policy bring us back rather than limp along half-started.
      setTimeout(() => process.exit(1), 100);
    }
    throw err;
  });
  return holder.ready;
}

async function boot(): Promise<AppContext> {
  const started = Date.now();
  const { db, sqlite } = await openDatabase({
    dbPath: env.dbPath,
    migrationsDir: env.migrationsDir,
    backupsDir: env.backupsDir,
    log: createLogger("db"),
  });

  ensureDefaultFolder(db, env.libraryDir);
  const scanState = createScanState();
  const scanner = createScanner({
    db,
    folders: () => listFolders(db),
    coversDir: env.coversDir,
    probeConcurrency: env.probeConcurrency,
    missingGraceMs: env.missingGraceMs,
    log: createLogger("scanner"),
    state: scanState,
  });

  const watchLog = createLogger("watcher");
  const startWatch = () =>
    startWatcher({
      folders: listFolders(db).map((f) => f.path),
      polling: env.watchPolling,
      debounceMs: env.watchDebounceMs,
      periodicMs: env.periodicScanMs,
      onChange: (paths) => void (paths ? scanner.scanChanged(paths) : scanner.scan()),
      log: watchLog,
    });
  let currentWatcher = startWatch();
  const watcher: LibraryWatcher = {
    mode: () => currentWatcher.mode(),
    // Closes the music watcher too, which is set up below.
    close: async () => {
      await currentWatcher.close();
      await musicWatcher.close();
      await videoWatcher.close();
    },
  };
  const library: AppContext["library"] = {
    folders: () => listFolders(db),
    saveFolders: async (paths) => {
      const saved = saveFolders(db, paths);
      await currentWatcher.close();
      currentWatcher = startWatch();
      void scanner.scan();
      return saved;
    },
  };

  await ensureMountedFolder(db, sqlite, "music", env.musicDir);
  const musicState = createScanState();
  const musicScanner = createMusicScanner({
    sqlite,
    folders: () => listFolders(db, "music"),
    coversDir: env.coversDir,
    probeConcurrency: env.probeConcurrency,
    missingGraceMs: env.missingGraceMs,
    log: createLogger("music"),
    state: musicState,
    afterScan: () => fillArtistPhotos(sqlite),
  });
  // Music has its own watcher: any change rescans the music folders, which only probes what changed.
  const startMusicWatch = () =>
    startWatcher({
      folders: listFolders(db, "music").map((f) => f.path),
      polling: env.watchPolling,
      debounceMs: env.watchDebounceMs,
      periodicMs: env.periodicScanMs,
      onChange: () => void musicScanner.scan(),
      log: watchLog,
    });
  let musicWatcher = startMusicWatch();
  const music: AppContext["music"] = {
    scanner: musicScanner,
    state: musicState,
    folders: () => listFolders(db, "music"),
    saveFolders: async (paths) => {
      const saved = saveFolders(db, paths, "music");
      await musicWatcher.close();
      musicWatcher = startMusicWatch();
      void musicScanner.scan();
      return saved;
    },
  };

  await ensureMountedFolder(db, sqlite, "movies", env.moviesDir);
  await ensureMountedFolder(db, sqlite, "shows", env.showsDir);
  const watchState = createScanState();
  const watchFolders = () => ({ movies: listFolders(db, "movies"), shows: listFolders(db, "shows") });
  // Online details only with a TMDB key; without one Watch runs on local files.
  const matcher = env.tmdbApiKey
    ? createWatchMatcher({
        sqlite,
        coversDir: env.coversDir,
        log: createLogger("watch-match"),
        tmdb: createTmdb(sqlite, { apiKey: env.tmdbApiKey, language: env.tmdbLanguage, userAgent: `Murmur/${env.version}` }),
      })
    : null;
  const watchScanner = createWatchScanner({
    sqlite,
    folders: watchFolders,
    coversDir: env.coversDir,
    probeConcurrency: env.probeConcurrency,
    missingGraceMs: env.missingGraceMs,
    log: createLogger("watch"),
    state: watchState,
    matchPending: matcher?.matchPending,
  });
  // Movies and shows share one watcher; any change rescans them, which only probes what changed.
  const startVideoWatch = () => {
    const { movies, shows } = watchFolders();
    return startWatcher({
      folders: [...movies, ...shows].map((f) => f.path),
      polling: env.watchPolling,
      debounceMs: env.watchDebounceMs,
      periodicMs: env.periodicScanMs,
      onChange: () => void watchScanner.scan(),
      log: watchLog,
    });
  };
  let videoWatcher = startVideoWatch();
  const watch: AppContext["watch"] = {
    scanner: watchScanner,
    state: watchState,
    folders: watchFolders,
    matcher,
    saveFolders: async (kind, paths) => {
      saveFolders(db, paths, kind);
      await videoWatcher.close();
      videoWatcher = startVideoWatch();
      void watchScanner.scan();
    },
  };

  const podcastLog = createLogger("podcasts");
  removeOldEpisodeDownloads(podcastLog);
  const podcasts = createPodcastService({
    sqlite,
    coversDir: env.coversDir,
    feedCheckMs: env.feedCheckMs,
    version: env.version,
    log: podcastLog,
    onPodcastRemoved: (podcastId) => episodeCache.removePodcast(podcastId),
  });
  const episodeCache = createEpisodeCache({
    sqlite,
    dir: env.episodeCacheDir,
    maxBytes: env.episodeCacheMaxBytes,
    version: env.version,
    log: createLogger("episode-cache"),
    onReady: (fileId) => queueScan(sqlite, fileId),
  });
  episodeCache.init();
  queueUnscanned(sqlite);
  // New episodes are downloaded right after each round of feed checks, including the one at startup.
  startFeedScheduler(podcasts, podcastLog, () => episodeCache.prefetch());

  scheduleNightlyBackup(sqlite);
  registerShutdown(sqlite, watcher);
  startUpdateChecks();

  setBusy(() => scanState.running || musicState.running || watchState.running || !!matcher?.busy());
  void scanner.scan(); // initial scans run in the background; the server is usable meanwhile
  void musicScanner.scan();
  void watchScanner.scan();
  log.info("murmur started", {
    version: env.version,
    ms: Date.now() - started,
    library: listFolders(db).map((f) => f.path),
    music: listFolders(db, "music").map((f) => f.path),
    movies: listFolders(db, "movies").map((f) => f.path),
    shows: listFolders(db, "shows").map((f) => f.path),
    data: env.dataDir,
    watcher: watcher.mode(),
  });
  return { db, sqlite, scanner, scanState, watcher, library, music, watch, podcasts, episodeCache, startedAt: started };
}

/** Episodes used to be downloaded to DATA_DIR/podcasts; the episode cache has its own folder now. */
function removeOldEpisodeDownloads(podcastLog: Logger) {
  const dir = path.join(env.dataDir, "podcasts");
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    podcastLog.info("removed old server episode downloads", { dir });
  } catch (err) {
    podcastLog.warn("couldn't remove old episode downloads", { dir, error: errorMessage(err) });
  }
}

function scheduleNightlyBackup(sqlite: Sqlite) {
  const backupLog = createLogger("backup");
  const next = new Date();
  next.setHours(env.backupHour, 0, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  const timer = setTimeout(async () => {
    try {
      pruneProviderCache(sqlite);
      await backupDatabase(sqlite, env.backupsDir, env.backupKeep, backupLog);
    } catch (err) {
      backupLog.error("nightly backup failed", { error: errorMessage(err) });
    }
    scheduleNightlyBackup(sqlite);
  }, next.getTime() - Date.now());
  timer.unref();
}

function registerShutdown(sqlite: Sqlite, watcher: LibraryWatcher) {
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log.info("shutting down", { signal });
    try {
      await watcher.close();
      sqlite.close(); // checkpoints the WAL so the database file is complete on disk
    } catch (err) {
      log.error("error during shutdown", { error: errorMessage(err) });
    }
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}
