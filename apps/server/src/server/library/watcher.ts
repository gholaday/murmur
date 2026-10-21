import { watch, type FSWatcher } from "chokidar";
import { errorMessage, type Logger } from "../log";
import { isIgnoredName } from "./parse";

export type WatchMode = "events" | "polling" | "periodic-only";

interface WatcherOptions {
  folders: string[];
  polling: boolean;
  debounceMs: number;
  periodicMs: number;
  /** The paths that changed, or null for a full rescan (periodic, or too many changes to track). */
  onChange: (paths: string[] | null) => void;
  log: Logger;
}

/** Beyond this many changed paths in one quiet period, rescanning everything is simpler. */
const MAX_TRACKED_PATHS = 500;

export interface LibraryWatcher {
  mode: () => WatchMode;
  close: () => Promise<void>;
}

/**
 * Watches the library and triggers a rescan after a quiet period. If file events
 * can't be used (for example the NAS's inotify watch limit is reached), it falls
 * back to the periodic rescan alone instead of failing.
 */
export function startWatcher(opts: WatcherOptions): LibraryWatcher {
  const { log } = opts;
  let mode: WatchMode = opts.polling ? "polling" : "events";
  let debounce: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;
  let changed: Set<string> | null = new Set();

  const schedule = (_event: string, p: string) => {
    if (changed && changed.size < MAX_TRACKED_PATHS) changed.add(p);
    else changed = null;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      const paths = changed ? [...changed] : null;
      changed = new Set();
      opts.onChange(paths);
    }, opts.debounceMs);
  };

  try {
    watcher = watch(opts.folders, {
      ignoreInitial: true,
      persistent: true,
      usePolling: opts.polling,
      interval: 10_000,
      binaryInterval: 10_000,
      ignored: (p: string) => p.split(/[\\/]/).some((part) => part !== "" && isIgnoredName(part)),
      awaitWriteFinish: false,
    });
    watcher.on("all", schedule);
    watcher.on("error", (err) => {
      log.warn("file watcher failed, falling back to periodic scans", { error: errorMessage(err) });
      mode = "periodic-only";
      void watcher?.close();
      watcher = null;
    });
  } catch (err) {
    log.warn("file watcher unavailable, using periodic scans only", { error: errorMessage(err) });
    mode = "periodic-only";
  }

  const periodic = setInterval(() => opts.onChange(null), opts.periodicMs);
  periodic.unref();

  return {
    mode: () => mode,
    close: async () => {
      clearInterval(periodic);
      if (debounce) clearTimeout(debounce);
      await watcher?.close();
    },
  };
}
