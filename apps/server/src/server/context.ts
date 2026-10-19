import fs from "node:fs";
import path from "node:path";
import { backupDatabase, openDatabase, type Db, type Sqlite } from "./db";
import { env } from "./env";
import { ensureDefaultFolder, listFolders, saveFolders, type LibraryFolder } from "./library/folders";
import { createScanState, createScanner, type ScanState, type Scanner } from "./library/scanner";
import { startWatcher, type LibraryWatcher } from "./library/watcher";
import { createLogger, errorMessage, type Logger } from "./log";
import { createPodcastService, startFeedScheduler, type PodcastService } from "./podcasts/service";

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
  podcasts: PodcastService;
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
    ffprobePath: env.ffprobePath,
    ffmpegPath: env.ffmpegPath,
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
      onChange: () => void scanner.scan(),
      log: watchLog,
    });
  let currentWatcher = startWatch();
  const watcher: LibraryWatcher = { mode: () => currentWatcher.mode(), close: () => currentWatcher.close() };
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

  const podcastLog = createLogger("podcasts");
  removeOldEpisodeDownloads(podcastLog);
  const podcasts = createPodcastService({
    sqlite,
    coversDir: env.coversDir,
    feedCheckMs: env.feedCheckMs,
    version: env.version,
    log: podcastLog,
  });
  startFeedScheduler(podcasts, podcastLog);

  scheduleNightlyBackup(sqlite);
  registerShutdown(sqlite, watcher);

  void scanner.scan(); // initial scan runs in the background; the server is usable meanwhile
  log.info("murmur started", {
    version: env.version,
    ms: Date.now() - started,
    library: listFolders(db).map((f) => f.path),
    data: env.dataDir,
    watcher: watcher.mode(),
  });
  return { db, sqlite, scanner, scanState, watcher, library, podcasts, startedAt: started };
}

/** Episodes used to be downloaded to DATA_DIR/podcasts; they now only download to phones. */
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
