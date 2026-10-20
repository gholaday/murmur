import { serverSettingsPatchSchema } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { cacheStatus } from "@/server/podcasts/cache-status";
import { saveServerSettings } from "@/server/settings";

/** The episode cache and ad detection, for admins. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  return json(cacheStatus(ctx));
});

/** Changes how many episodes per show are kept ready, and fetches any newly wanted ones. */
export const PUT = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  saveServerSettings(ctx.sqlite, await readJson(req, serverSettingsPatchSchema));
  void ctx.episodeCache.prefetch();
  return json(cacheStatus(ctx));
});
