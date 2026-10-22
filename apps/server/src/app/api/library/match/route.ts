import { bulkMatchStartSchema } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { bulkMatchStatus, startBulkMatch, stopBulkMatch } from "@/server/metadata/bulk-match";

/** The current or last bulk match, or null. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  return json(bulkMatchStatus());
});

/** Starts matching every unmatched book. */
export const POST = route(async (req) => {
  const ctx = await getContext();
  const user = requireAdmin(ctx, req);
  return json(await startBulkMatch(ctx, user.id, await readJson(req, bulkMatchStartSchema)));
});

/** Stops a running bulk match, or clears a finished one. */
export const DELETE = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  return json(stopBulkMatch());
});
