import { albumSortSchema, musicScopeSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { jsonWithEtag, route } from "@/server/http";
import { listAlbums } from "@/server/music/queries";

/** Albums: `?scope=mine|all` (your music or Browse) and `?sort=added|name|artist|year`. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const params = new URL(req.url).searchParams;
  const sort = albumSortSchema.parse(params.get("sort") ?? undefined);
  const scope = musicScopeSchema.parse(params.get("scope") ?? undefined);
  return jsonWithEtag(req, await listAlbums(ctx, user.id, scope, sort));
});
