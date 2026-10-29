import { type CastLinkDto, castSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { CAST_TOKEN_MS, castKey, castPrefixAllowed, signCastToken } from "@/server/cast";
import { getContext } from "@/server/context";
import { HttpError, json, readJson, route } from "@/server/http";

/** Links a Chromecast can open without signing in, for one item's stream and its cover. */
export const POST = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const { paths } = await readJson(req, castSchema);
  const refused = paths.find((p) => !castPrefixAllowed(p));
  if (refused) throw new HttpError(400, `A cast can't open ${refused}.`);
  const token = signCastToken(castKey(ctx.sqlite), user.id, paths);
  return json<CastLinkDto>({ base: `/api/cast/${token}`, expiresAt: Date.now() + CAST_TOKEN_MS });
});
