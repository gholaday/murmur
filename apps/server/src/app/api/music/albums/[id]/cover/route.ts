import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { coverResponse } from "@/server/cover-response";
import { route } from "@/server/http";
import { getAlbumCoverHash } from "@/server/music/queries";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  return coverResponse(req, getAlbumCoverHash(ctx, (await params).id));
});
