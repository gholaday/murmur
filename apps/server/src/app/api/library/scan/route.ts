import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";

/** Starts a rescan in the background. Poll /api/health for its result. */
export const POST = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  void ctx.scanner.scan();
  return json({ started: true }, { status: 202 });
});
