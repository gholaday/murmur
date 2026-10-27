import { albumMatchAllStartSchema } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { albumMatchAllStatus, startAlbumMatchAll, stopAlbumMatchAll } from "@/server/music/match-all";

/** The current or last album Match all, or null. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  return json(albumMatchAllStatus());
});

/** Starts matching every unmatched album. */
export const POST = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const { fields } = await readJson(req, albumMatchAllStartSchema);
  return json(await startAlbumMatchAll(ctx, fields));
});

/** Stops a running match, or clears a finished one. */
export const DELETE = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  return json(stopAlbumMatchAll());
});
