import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { hiddenFor, visibleArtists } from "@/server/hidden";
import { jsonWithEtag, route } from "@/server/http";
import { listArtists } from "@/server/music/queries";

/** Album artists, A to Z, leaving out ones you hid. An old `?scope=` is ignored (gone in 2.0). */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return jsonWithEtag(req, visibleArtists(listArtists(ctx), hiddenFor(ctx, user.id)));
});
