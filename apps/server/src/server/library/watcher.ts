import { watch, type FSWatcher } from "chokidar";
import { errorMessage, type Logger } from "../log";
import { isIgnoredName } from "./parse";

export type WatchMode = "events" | "polling" | "periodic-only";

interface WatcherOptions {
  folders: string[];
  polling: boolean;
  debounceMs: number;
  periodicMs: number;
  onChange: () => void;
  log: Logger;
}

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

  const schedule = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      opts.onChange();
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

  const periodic = setInterval(opts.onChange, opts.periodicMs);
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
