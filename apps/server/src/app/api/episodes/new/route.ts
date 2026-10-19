import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { jsonWithEtag, route } from "@/server/http";
import { listNewEpisodes } from "@/server/podcasts/queries";

/** Newest unplayed episodes across your shows; `?limit=` up to 200. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 50));
  return jsonWithEtag(req, await listNewEpisodes(ctx.sqlite, user.id, limit));
});
