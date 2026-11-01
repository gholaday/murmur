import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, route } from "@/server/http";
import { subtitleVtt } from "@/server/watch/subtitles";

type Ctx = { params: Promise<{ id: string; track: string }> };

/**
 * A subtitle track as WebVTT, `e3.vtt`. `offset` moves it onto a stream's clock, for a Chromecast
 * playing one. Answers 503 with Retry-After while the track is read out of the video.
 */
export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  const { id, track } = await params;
  if (!track.endsWith(".vtt")) throw new HttpError(404, "That subtitle isn't there.");
  const offset = Number(new URL(req.url).searchParams.get("offset") ?? 0);
  if (!Number.isFinite(offset) || offset < 0) throw new HttpError(400, "That offset isn't a time.");
  return new Response(await subtitleVtt(ctx, id, track.slice(0, -4), offset), {
    headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "private, no-cache" },
  });
});
