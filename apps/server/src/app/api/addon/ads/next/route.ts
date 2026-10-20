import { claimNext, requireAddon } from "@/server/ads";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";

/** The ad detection add-on's next scan (`{ job: null }` when there's nothing to do). */
export const POST = route(async (req) => {
  requireAddon(req);
  const ctx = await getContext();
  return json({ job: claimNext(ctx.sqlite) });
});
