import { albumSortSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { jsonWithEtag, route } from "@/server/http";
import { listAlbums } from "@/server/music/queries";

/** Every album: `?sort=added|name|artist|year`. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  const sort = albumSortSchema.parse(new URL(req.url).searchParams.get("sort") ?? undefined);
  return jsonWithEtag(req, await listAlbums(ctx, sort));
});
