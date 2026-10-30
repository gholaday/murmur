import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, route } from "@/server/http";
import { watchArtOptions } from "@/server/watch/edit";

type Ctx = { params: Promise<{ id: string; kind: string }> };

/** Edit's suggestions: TMDB's posters or backdrops for this show. */
export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const { id, kind } = await params;
  if (kind !== "poster" && kind !== "backdrop") throw new HttpError(404, "Not found.");
  return json(await watchArtOptions(ctx, "show", id, kind));
});
