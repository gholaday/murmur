import { watchDownloadSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { videoSource } from "@/server/watch/queries";
import { startDownload } from "@/server/watch/video-addon";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Starts making this video into an MP4 for the phone, `{ track, audio, video, quality }`, or reports
 * on the one already being made: VideoDownloadDto. Ask again every few seconds until it's ready.
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const choices = await readJson(req, watchDownloadSchema);
  return json(await startDownload(String(user.id), videoSource(ctx, (await params).id, choices)));
});
