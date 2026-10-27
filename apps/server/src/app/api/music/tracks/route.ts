import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { jsonWithEtag, route } from "@/server/http";
import { listTracks } from "@/server/music/queries";

/** Songs A to Z, or `?q=` to search titles, artists and albums. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 200) || null;
  return jsonWithEtag(req, listTracks(ctx, q));
});
