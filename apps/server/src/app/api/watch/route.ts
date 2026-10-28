import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { jsonWithEtag, route } from "@/server/http";
import { watchHome } from "@/server/watch/queries";

/** WatchHomeDto: Continue watching, Next episodes and Recently added. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return jsonWithEtag(req, await watchHome(ctx, user.id));
});
