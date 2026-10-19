import { userPrefsPatchSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { getPrefs, updatePrefs } from "@/server/prefs";

export const GET = route(async (req) => {
  const ctx = await getContext();
  return json(getPrefs(ctx, requireUser(ctx, req).id));
});

export const PUT = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return json(updatePrefs(ctx, user.id, await readJson(req, userPrefsPatchSchema)));
});
