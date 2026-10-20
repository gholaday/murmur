import fs from "node:fs/promises";
import type { HealthDto } from "@murmur/shared";
import { adsEnabled } from "@/server/ads";
import { getContext } from "@/server/context";
import { env } from "@/server/env";

export async function GET(): Promise<Response> {
  let ctx;
  try {
    ctx = await getContext();
  } catch {
    return Response.json({ ok: false, error: "Server failed to start." }, { status: 503 });
  }

  let database = true;
  let books = 0;
  try {
    books = (ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM books WHERE missing_since IS NULL").get() as { n: number }).n;
  } catch {
    database = false;
  }
  // Reachable only when every library folder can be opened.
  const folders = ctx.library.folders();
  const access = await Promise.all(folders.map((f) => fs.access(f.path).then(() => true, () => false)));
  const reachable = folders.length > 0 && access.every(Boolean);

  const body: HealthDto = {
    ok: database,
    version: env.version,
    uptimeSec: Math.round((Date.now() - ctx.startedAt) / 1000),
    database,
    library: { reachable, books },
    adDetection: adsEnabled(),
    scan: {
      running: ctx.scanState.running,
      lastFinishedAt: ctx.scanState.lastFinishedAt,
      lastDurationMs: ctx.scanState.lastDurationMs,
      lastError: ctx.scanState.lastError,
    },
    watcher: ctx.watcher.mode(),
  };
  // Only a broken database makes the container unhealthy; an unreachable library is
  // reported but restarting the container would not fix a share that isn't mounted.
  return Response.json(body, { status: database ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
