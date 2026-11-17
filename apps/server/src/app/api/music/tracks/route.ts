import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { hiddenFor, visibleTracks } from "@/server/hidden";
import { jsonWithEtag, route } from "@/server/http";
import { listTracks } from "@/server/music/queries";

/** Songs A to Z, or `?q=` to search titles, artists and albums. An old `?scope=` is ignored (gone in 2.0). */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 200) || null;
  return jsonWithEtag(req, visibleTracks(listTracks(ctx, user.id, q), hiddenFor(ctx, user.id)));
});
