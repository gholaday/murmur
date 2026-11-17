import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { hiddenFor, withoutIds } from "@/server/hidden";
import { jsonWithEtag, route } from "@/server/http";
import { listMovies } from "@/server/watch/queries";

/** Every movie, leaving out ones you hid. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return jsonWithEtag(req, withoutIds(await listMovies(ctx, user.id), hiddenFor(ctx, user.id).movies));
});
