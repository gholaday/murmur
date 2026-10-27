import { albumMatchAllApplySchema } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { applyAlbumMatchAll } from "@/server/music/match-all";

/** Applies the reviewed Match all results for the picked albums. */
export const POST = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const { albumIds } = await readJson(req, albumMatchAllApplySchema);
  return json(await applyAlbumMatchAll(ctx, albumIds));
});
