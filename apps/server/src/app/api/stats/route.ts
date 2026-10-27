import { statsQuerySchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { jsonWithEtag, route } from "@/server/http";
import { getStats } from "@/server/stats";

/** Listening stats: `?period=week|month|year|all&today=YYYY-MM-DD&tz=<minutes east of UTC>`. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const q = statsQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return jsonWithEtag(req, await getStats(ctx, user.id, q.period, q.today, q.tz));
});
