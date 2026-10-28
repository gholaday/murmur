import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, jsonWithEtag, route } from "@/server/http";
import { getMovie } from "@/server/watch/queries";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const movie = await getMovie(ctx, user.id, (await params).id);
  if (!movie) throw new HttpError(404, "Movie not found.");
  return jsonWithEtag(req, movie);
});
