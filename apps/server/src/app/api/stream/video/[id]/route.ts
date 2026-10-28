import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, route } from "@/server/http";
import { videoMimeType } from "@/server/watch/parse";
import { getVideoFile } from "@/server/watch/queries";
import { resolveInside, streamFile } from "@/server/stream";

type Ctx = { params: Promise<{ id: string }> };

/** The video file as it is, with range requests, so seeking is instant. */
const handler = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  const file = getVideoFile(ctx, (await params).id);
  if (!file) throw new HttpError(404, "Video not found.");
  if (!file.root) throw new HttpError(404, "This video's folder was removed.");
  return streamFile(req, resolveInside(file.root, file.relPath), videoMimeType(file.relPath));
});

export const GET = handler;
export const HEAD = handler;
