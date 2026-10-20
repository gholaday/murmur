import { retryFailed } from "@/server/ads";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";

/** Puts every failed ad scan back in the queue. */
export const POST = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  return json({ retried: retryFailed(ctx.sqlite) });
});
