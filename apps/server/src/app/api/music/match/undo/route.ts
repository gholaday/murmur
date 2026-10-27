import { albumMatchAllUndoSchema } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { undoAlbumMatchAll } from "@/server/music/match-all";

/** Puts an album that Match all applied back the way it was. */
export const POST = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const { albumId } = await readJson(req, albumMatchAllUndoSchema);
  return json(undoAlbumMatchAll(ctx, albumId));
});
