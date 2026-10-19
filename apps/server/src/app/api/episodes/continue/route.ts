import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { jsonWithEtag, route } from "@/server/http";
import { listContinueEpisodes } from "@/server/podcasts/queries";

/** Started, unfinished episodes, most recently listened first; `?limit=` up to 200. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const limit = Math.min(200, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 20));
  return jsonWithEtag(req, await listContinueEpisodes(ctx.sqlite, user.id, limit));
});
