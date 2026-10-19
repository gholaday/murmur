import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { jsonWithEtag, route } from "@/server/http";
import { listNewEpisodes, shortNotes } from "@/server/podcasts/queries";

/** Newest unplayed episodes across your shows; `?limit=` up to 200, `?short=1` cuts the notes. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const params = new URL(req.url).searchParams;
  const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 50));
  const episodes = await listNewEpisodes(ctx.sqlite, user.id, limit);
  return jsonWithEtag(req, params.get("short") === "1" ? shortNotes(episodes) : episodes);
});
