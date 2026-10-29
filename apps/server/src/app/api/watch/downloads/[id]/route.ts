import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { route } from "@/server/http";
import { cancelDownload, downloadResponse } from "@/server/watch/video-addon";

type Ctx = { params: Promise<{ id: string }> };

/** A finished download's MP4, with range requests so an interrupted download can resume. */
const handler = route<Ctx>(async (req, { params }) => {
  const user = requireUser(await getContext(), req);
  return downloadResponse(req, String(user.id), (await params).id);
});

export const GET = handler;
export const HEAD = handler;

/** Cancels a download being made, or removes a finished one from the server. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const user = requireUser(await getContext(), req);
  await cancelDownload(String(user.id), (await params).id);
  return new Response(null, { status: 204 });
});
