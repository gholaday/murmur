import { type StreamSessionDto, watchStreamSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, readJson, route } from "@/server/http";
import { getStreamSource } from "@/server/watch/queries";
import { startStream } from "@/server/watch/stream-session";

type Ctx = { params: Promise<{ id: string }> };

/** Starts an HLS stream of this video from `start`, with one audio track, the picture copied or converted to H.264. */
export const POST = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const videoId = (await params).id;
  const { track, audio, video, quality, start } = await readJson(req, watchStreamSchema);
  const found = getStreamSource(ctx, videoId);
  if (!found) throw new HttpError(404, "Video not found.");
  if (found.audioCodecs.length > 0 && track >= found.audioCodecs.length) throw new HttpError(400, "That audio track isn't in the file.");
  const { file, videoCodec, width, height, hdr } = found;
  const src = { videoId, file, videoCodec, width, height, hdr, audioCodec: found.audioCodecs[track] ?? null, track, audio, video, quality };
  const session = await startStream(user.id, src, start);
  return json({ ...session, playlistUrl: `/api/watch/streams/${session.sessionId}/master.m3u8` } satisfies StreamSessionDto);
});
