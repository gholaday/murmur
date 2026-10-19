import { backupDatabase, openDatabase, type Db, type Sqlite } from "./db";
import { env } from "./env";
import { createScanState, createScanner, type ScanState, type Scanner } from "./library/scanner";
import { startWatcher, type LibraryWatcher } from "./library/watcher";
import { createLogger, errorMessage } from "./log";
import { createPodcastService, startFeedScheduler, type PodcastService } from "./podcasts/service";

export interface AppContext {
  db: Db;
  sqlite: Sqlite;
  scanner: Scanner;
  scanState: ScanState;
  watcher: LibraryWatcher;
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

  const scanState = createScanState();
  const scanner = createScanner({
    db,
    libraryDir: env.libraryDir,
    coversDir: env.coversDir,
    ffprobePath: env.ffprobePath,
    ffmpegPath: env.ffmpegPath,
    probeConcurrency: env.probeConcurrency,
    missingGraceMs: env.missingGraceMs,
    log: createLogger("scanner"),
    state: scanState,
  });

  const watcher = startWatcher({
    libraryDir: env.libraryDir,
    polling: env.watchPolling,
    debounceMs: env.watchDebounceMs,
    periodicMs: env.periodicScanMs,
    onChange: () => void scanner.scan(),
    log: createLogger("watcher"),
  });

  const podcastLog = createLogger("podcasts");
  const podcasts = createPodcastService({
    sqlite,
    podcastsDir: env.podcastsDir,
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
    library: env.libraryDir,
    data: env.dataDir,
    watcher: watcher.mode(),
  });
  return { db, sqlite, scanner, scanState, watcher, podcasts, startedAt: started };
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
