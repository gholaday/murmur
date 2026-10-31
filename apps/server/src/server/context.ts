import fs from "node:fs";
import path from "node:path";
import { noteBackupFailed } from "./backup-status";
import { backupDatabase, openDatabase, type Db, type Sqlite } from "./db";
import { env } from "./env";
import { listFolders, syncFolders, type LibraryFolder } from "./library/folders";
import { createWatchScanner, type WatchScanner } from "./watch/scanner";
import { createWatchMatcher, type WatchMatcher } from "./watch/match";
import { createTmdb, type Tmdb } from "./watch/tmdb";
import { setBusy } from "./changes";
import { autoMatching, autoMatchPending } from "./metadata/auto-match";
import { pruneProviderCache } from "./metadata/providers";
import { fillArtistPhotos } from "./music/match";
import { createMusicScanner, type MusicScanner } from "./music/scanner";
import { createScanState, createScanner, type ScanState, type Scanner } from "./library/scanner";
import { startWatcher, type LibraryWatcher } from "./library/watcher";
import { createLogger, errorMessage, type Logger } from "./log";
import { queueScan, queueUnscanned } from "./ads";
import { createChapterFinder, type ChapterFinder } from "./podcasts/chapters";
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
  };
  music: {
    scanner: MusicScanner;
    state: ScanState;
    folders: () => LibraryFolder[];
  };
  watch: {
    scanner: WatchScanner;
    state: ScanState;
    folders: () => { movies: LibraryFolder[]; shows: LibraryFolder[] };
    /** TMDB matching; null without a TMDB key. */
    matcher: WatchMatcher | null;
    /** TMDB itself, for Edit's pictures; null without a TMDB key. */
    tmdb: Tmdb | null;
  };
  podcasts: PodcastService;
  episodeCache: EpisodeCache;
  /** Episode chapters, looked up the first time they're wanted. */
  chapters: ChapterFinder;
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

  // Folders come from what's mounted, checked on every start.
  await syncFolders(db, "books", env.libraryDir);
  await syncFolders(db, "music", env.musicDir);
  await syncFolders(db, "movies", env.moviesDir);
  await syncFolders(db, "shows", env.showsDir);
  const scanState = createScanState();
  const scanner = createScanner({
    db,
    folders: () => listFolders(db),
    coversDir: env.coversDir,
    probeConcurrency: env.probeConcurrency,
    missingGraceMs: env.missingGraceMs,
    log: createLogger("scanner"),
    state: scanState,
    afterScan: () => autoMatchPending(getContext),
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
  const currentWatcher = startWatch();
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
  };

  const musicState = createScanState();
  const musicScanner = createMusicScanner({
    sqlite,
    folders: () => listFolders(db, "music"),
    coversDir: env.coversDir,
    probeConcurrency: env.probeConcurrency,
    missingGraceMs: env.missingGraceMs,
    log: createLogger("music"),
    state: musicState,
    afterScan: async () => {
      await fillArtistPhotos(sqlite);
      await autoMatchPending(getContext);
    },
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
  const musicWatcher = startMusicWatch();
  const music: AppContext["music"] = {
    scanner: musicScanner,
    state: musicState,
    folders: () => listFolders(db, "music"),
  };

  const watchState = createScanState();
  const watchFolders = () => ({ movies: listFolders(db, "movies"), shows: listFolders(db, "shows") });
  // Online details only with a TMDB key; without one Watch runs on local files.
  const tmdb = env.tmdbApiKey
    ? createTmdb(sqlite, { apiKey: env.tmdbApiKey, language: env.tmdbLanguage, userAgent: `Murmur/${env.version}` })
    : null;
  const matcher = tmdb ? createWatchMatcher({ sqlite, coversDir: env.coversDir, log: createLogger("watch-match"), tmdb }) : null;
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
  const videoWatcher = startVideoWatch();
  const watch: AppContext["watch"] = {
    scanner: watchScanner,
    state: watchState,
    folders: watchFolders,
    matcher,
    tmdb,
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
    onFeedSaved: (podcastId) => void chapters.prefetch(podcastId),
  });
  const chapters = createChapterFinder({
    sqlite,
    log: podcastLog,
    version: env.version,
    cachedFile: (episodeId) => episodeCache.readyFile(episodeId),
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

  setBusy(() => scanState.running || musicState.running || watchState.running || !!matcher?.busy() || autoMatching());
  void scanner.scan(); // initial scans run in the background; the server is usable meanwhile
  void musicScanner.scan();
  void watchScanner.scan();
  if (env.addonSecretProblem) log.error(`${env.addonSecretProblem} Until then the add-ons are off.`);
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
  return { db, sqlite, scanner, scanState, watcher, library, music, watch, podcasts, episodeCache, chapters, startedAt: started };
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
      noteBackupFailed();
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
