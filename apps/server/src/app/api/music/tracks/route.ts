import { musicScopeSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { jsonWithEtag, route } from "@/server/http";
import { listTracks } from "@/server/music/queries";

/** Songs A to Z, or `?q=` to search titles, artists and albums; `?scope=mine|all`. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim().slice(0, 200) || null;
  const scope = musicScopeSchema.parse(params.get("scope") ?? undefined);
  return jsonWithEtag(req, listTracks(ctx, user.id, scope, q));
});
