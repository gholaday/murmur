import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";

/** Starts a movies and shows rescan in the background. */
export const POST = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  void ctx.watch.scanner.scan();
  return json({ started: true }, { status: 202 });
});
