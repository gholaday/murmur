import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { hiddenFor, withoutIds } from "@/server/hidden";
import { jsonWithEtag, route } from "@/server/http";
import { listShows } from "@/server/watch/queries";

/** Every show, leaving out ones you hid. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return jsonWithEtag(req, withoutIds(await listShows(ctx, user.id), hiddenFor(ctx, user.id).shows));
});
