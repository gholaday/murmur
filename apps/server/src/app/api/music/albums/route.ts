import { albumSortSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { hiddenFor, visibleAlbums } from "@/server/hidden";
import { jsonWithEtag, route } from "@/server/http";
import { listAlbums } from "@/server/music/queries";

/** Albums, `?sort=added|name|artist|year`, leaving out ones you hid. An old `?scope=` is ignored (gone in 2.0). */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const sort = albumSortSchema.parse(new URL(req.url).searchParams.get("sort") ?? undefined);
  return jsonWithEtag(req, visibleAlbums(await listAlbums(ctx, user.id, sort), hiddenFor(ctx, user.id)));
});
