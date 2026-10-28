import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { route } from "@/server/http";
import { artResponse } from "@/server/watch/art";
import { videoStillHash } from "@/server/watch/queries";

type Ctx = { params: Promise<{ id: string }> };

/** A movie version's or episode's still. */
export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  return artResponse(req, videoStillHash(ctx, (await params).id), "wide");
});
