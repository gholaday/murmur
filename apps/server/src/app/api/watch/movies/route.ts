import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { jsonWithEtag, route } from "@/server/http";
import { listMovies } from "@/server/watch/queries";

export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return jsonWithEtag(req, await listMovies(ctx, user.id));
});
