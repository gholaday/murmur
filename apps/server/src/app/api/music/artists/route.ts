import { musicScopeSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { jsonWithEtag, route } from "@/server/http";
import { listArtists } from "@/server/music/queries";

/** Album artists, A to Z: `?scope=mine|all`. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return jsonWithEtag(req, listArtists(ctx, user.id, musicScopeSchema.parse(new URL(req.url).searchParams.get("scope") ?? undefined)));
});
