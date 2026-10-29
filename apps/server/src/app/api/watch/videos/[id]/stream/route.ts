import { type StreamSessionDto, watchStreamSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { videoSource } from "@/server/watch/queries";
import { startStream } from "@/server/watch/video-addon";

type Ctx = { params: Promise<{ id: string }> };

/** Starts an HLS stream of this video from `start`, with one audio track, the picture copied or converted to H.264. */
export const POST = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const { start, ...choices } = await readJson(req, watchStreamSchema);
  const session = await startStream(String(user.id), videoSource(ctx, (await params).id, choices), start);
  return json({ ...session, playlistUrl: `/api/watch/streams/${session.sessionId}/master.m3u8` } satisfies StreamSessionDto);
});
