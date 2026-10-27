import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, route } from "@/server/http";
import { getTrackFile } from "@/server/music/queries";
import { resolveInside, streamFile } from "@/server/stream";

type Ctx = { params: Promise<{ id: string }> };

const handler = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  const file = getTrackFile(ctx, (await params).id);
  if (!file) throw new HttpError(404, "Song not found.");
  if (!file.root) throw new HttpError(404, "This song's music folder was removed.");
  return streamFile(req, resolveInside(file.root, file.relPath), file.mimeType);
});

export const GET = handler;
export const HEAD = handler;
