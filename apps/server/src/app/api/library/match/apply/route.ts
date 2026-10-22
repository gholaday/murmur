import { bulkMatchApplySchema } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { applyBulkMatches } from "@/server/metadata/bulk-match";

/** Applies the reviewed bulk match results for the picked books. */
export const POST = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const { bookIds } = await readJson(req, bulkMatchApplySchema);
  return json(await applyBulkMatches(ctx, bookIds));
});
