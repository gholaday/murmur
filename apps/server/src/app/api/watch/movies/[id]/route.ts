import { watchDetailsSchema } from "@murmur/shared";
import { requireAdmin, requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, jsonWithEtag, readJson, route } from "@/server/http";
import { saveWatchDetails } from "@/server/watch/edit";
import { getMovie } from "@/server/watch/queries";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const movie = await getMovie(ctx, user.id, (await params).id);
  if (!movie) throw new HttpError(404, "Movie not found.");
  return jsonWithEtag(req, movie);
});

/** Edit: the title, year and description, which a later match leaves alone. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  saveWatchDetails(ctx, "movie", (await params).id, await readJson(req, watchDetailsSchema));
  return json({ ok: true });
});
