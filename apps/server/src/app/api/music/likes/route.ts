import { musicLikeSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { like, unlike } from "@/server/music/queries";

/** Likes songs and albums. */
export const PUT = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  like(ctx, user.id, await readJson(req, musicLikeSchema));
  return json({ ok: true });
});

/** Unlikes songs and albums. */
export const DELETE = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  unlike(ctx, user.id, await readJson(req, musicLikeSchema));
  return json({ ok: true });
});
