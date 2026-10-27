import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { jsonWithEtag, route } from "@/server/http";
import { listArtists } from "@/server/music/queries";

/** Album artists, A to Z. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  return jsonWithEtag(req, listArtists(ctx));
});
