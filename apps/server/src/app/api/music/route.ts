import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { jsonWithEtag, route } from "@/server/http";
import { musicSummary } from "@/server/music/queries";

/** Whether the server has music, and how much; apps hide music entirely when it's off. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  return jsonWithEtag(req, musicSummary(ctx));
});
