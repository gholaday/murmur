import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";
import { musicSummary } from "@/server/music/queries";

// Deprecated, gone in 2.0: all music is shown now, so adding and removing do nothing. Older apps
// still call these and read the counts back.

export const PUT = route(async (req) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  return json(musicSummary(ctx));
});

export const DELETE = route(async (req) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  return json(musicSummary(ctx));
});
