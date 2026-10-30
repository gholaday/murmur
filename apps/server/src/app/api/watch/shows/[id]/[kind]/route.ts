import { requireAdmin, requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, route } from "@/server/http";
import { artResponse } from "@/server/watch/art";
import { removeWatchArt, setWatchArtFromRequest } from "@/server/watch/edit";
import { showArtHash } from "@/server/watch/queries";

type Ctx = { params: Promise<{ id: string; kind: string }> };

/** A show's poster or backdrop. */
export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  const { id, kind } = await params;
  if (kind !== "poster" && kind !== "backdrop") throw new HttpError(404, "Not found.");
  return artResponse(req, showArtHash(ctx, id, kind), kind === "poster" ? "poster" : "wide");
});

/** Edit: a new poster or backdrop, kept over TMDB's. */
export const POST = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const { id, kind } = await params;
  await setWatchArtFromRequest(ctx, req, "show", id, kind);
  return json({ ok: true });
});

/** Edit: takes off a chosen picture, bringing back the files' or TMDB's. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const { id, kind } = await params;
  await removeWatchArt(ctx, "show", id, kind);
  return json({ ok: true });
});
