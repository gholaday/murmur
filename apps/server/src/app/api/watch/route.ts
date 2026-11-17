import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { hiddenFor, visibleWatchHome } from "@/server/hidden";
import { jsonWithEtag, route } from "@/server/http";
import { watchHome } from "@/server/watch/queries";

/** WatchHomeDto: Continue watching, Next episodes and Recently added, leaving out what you hid. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return jsonWithEtag(req, visibleWatchHome(await watchHome(ctx, user.id), hiddenFor(ctx, user.id)));
});
