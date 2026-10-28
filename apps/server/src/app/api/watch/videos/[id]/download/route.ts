import { watchDownloadSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, readJson, route } from "@/server/http";
import { startDownload } from "@/server/watch/download";
import { getStreamSource } from "@/server/watch/queries";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Starts making this video into an MP4 for the phone, `{ track, audio, video, quality }`, or reports
 * on the one already being made: VideoDownloadDto. Ask again every few seconds until it's ready.
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const videoId = (await params).id;
  const { track, audio, video, quality } = await readJson(req, watchDownloadSchema);
  const found = getStreamSource(ctx, videoId);
  if (!found) throw new HttpError(404, "Video not found.");
  if (found.audioCodecs.length > 0 && track >= found.audioCodecs.length) throw new HttpError(400, "That audio track isn't in the file.");
  const { file, videoCodec, width, height, hdr, durationSec } = found;
  const src = { videoId, file, videoCodec, width, height, hdr, durationSec, audioCodec: found.audioCodecs[track] ?? null, track, audio, video, quality };
  return json(startDownload(user.id, src));
});
