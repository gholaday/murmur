type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = order[(process.env.LOG_LEVEL as Level) ?? "info"] ?? order.info;

function write(level: Level, scope: string, msg: string, extra?: Record<string, unknown>) {
  if (order[level] < minLevel) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, scope, msg, ...extra });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

/** One JSON line per event, like Murmur's own log, so `docker logs` reads the same. */
export function createLogger(scope: string) {
  return {
    debug: (msg: string, extra?: Record<string, unknown>) => write("debug", scope, msg, extra),
    info: (msg: string, extra?: Record<string, unknown>) => write("info", scope, msg, extra),
    warn: (msg: string, extra?: Record<string, unknown>) => write("warn", scope, msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => write("error", scope, msg, extra),
  };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
