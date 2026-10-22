import { bulkMatchUndoSchema } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { undoBulkMatch } from "@/server/metadata/bulk-match";

/** Puts a book that bulk match applied back the way it was. */
export const POST = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const { bookId } = await readJson(req, bulkMatchUndoSchema);
  return json(undoBulkMatch(ctx, bookId));
});
