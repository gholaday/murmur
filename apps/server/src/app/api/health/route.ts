import fs from "node:fs/promises";
import type { HealthDto, HealthProbeDto } from "@murmur/shared";
import { adsEnabled } from "@/server/ads";
import { tokenFromRequest, userFromToken } from "@/server/auth";
import { getContext } from "@/server/context";
import { env } from "@/server/env";
import { watchEnabled } from "@/server/watch/queries";
import { videoHealth, videoStatus } from "@/server/watch/video-addon";

async function watchHealth(ctx: Awaited<ReturnType<typeof getContext>>): Promise<NonNullable<HealthDto["watch"]>> {
  const counts = ctx.sqlite
    .prepare(
      `SELECT (SELECT COUNT(DISTINCT movie_id) FROM videos WHERE kind = 'movie' AND missing_since IS NULL) AS movies,
              (SELECT COUNT(*) FROM shows) AS shows`,
    )
    .get() as { movies: number; shows: number };
  const s = ctx.watch.state;
  // Reading and streaming video is the add-on's job; it reports its own ffmpeg and encoder.
  const video = await videoHealth();
  return {
    ...counts,
    addon: video !== null,
    ffmpeg: video?.ffmpeg ?? false,
    encoder: video?.encoder ?? "cpu",
    status: videoStatus(video),
    tmdb: ctx.watch.tmdb !== null,
    scan: { running: s.running, lastFinishedAt: s.lastFinishedAt, lastError: s.lastError },
  };
}

export async function GET(req: Request): Promise<Response> {
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
  const headers = { "Cache-Control": "no-store" };
  // Docker's check and the app's "is this a Murmur server?" send no token and need only this. The
  // rest (counts, paths in scan errors, what's set up) is for people signed in. A token that no
  // longer works is a 401, as everywhere else, so a signed-out client never reads the short answer
  // as the full one.
  const found = tokenFromRequest(req);
  if (!found) {
    return Response.json({ ok: database, version: env.version } satisfies HealthProbeDto, { status: database ? 200 : 503, headers });
  }
  if (!userFromToken(ctx, found.token)) return Response.json({ error: "Sign in to continue." }, { status: 401, headers });
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
    watch: watchEnabled(ctx) ? await watchHealth(ctx) : null,
  };
  // Only a broken database makes the container unhealthy; an unreachable library is
  // reported but restarting the container would not fix a share that isn't mounted.
  return Response.json(body, { status: database ? 200 : 503, headers });
}
