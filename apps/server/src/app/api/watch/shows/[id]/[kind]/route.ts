import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, route } from "@/server/http";
import { artResponse } from "@/server/watch/art";
import { showArtHash } from "@/server/watch/queries";

type Ctx = { params: Promise<{ id: string; kind: string }> };

/** A show's poster or backdrop. */
export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  const { id, kind } = await params;
  if (kind !== "poster" && kind !== "backdrop") throw new HttpError(404, "Not found.");
  return artResponse(req, showArtHash(ctx, id, kind), kind === "poster" ? "poster" : "wide");
});
