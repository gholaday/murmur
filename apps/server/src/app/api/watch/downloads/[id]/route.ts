import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { route } from "@/server/http";
import { streamFile } from "@/server/stream";
import { cancelDownload, downloadFile } from "@/server/watch/download";

type Ctx = { params: Promise<{ id: string }> };

/** A finished download's MP4, with range requests so an interrupted download can resume. */
const handler = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return streamFile(req, downloadFile(user.id, (await params).id), "video/mp4");
});

export const GET = handler;
export const HEAD = handler;

/** Cancels a download being made, or removes a finished one from the server. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  cancelDownload(user.id, (await params).id);
  return new Response(null, { status: 204 });
});
