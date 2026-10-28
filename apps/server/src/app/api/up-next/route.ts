import { queueAddSchema, upNextIndexSchema, upNextSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, jsonWithEtag, readJson, route } from "@/server/http";
import { addToUpNext, getUpNext, saveUpNext, setUpNextIndex } from "@/server/up-next";

/** Up Next: what played, what's playing and what's next. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return jsonWithEtag(req, await getUpNext(ctx, user.id));
});

/** Saves the whole list after the player changed it: a new album, a move, a removal, shuffle. */
export const PUT = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  saveUpNext(ctx, user.id, await readJson(req, upNextSchema));
  return json(await getUpNext(ctx, user.id));
});

/** Moves on to another item. */
export const PATCH = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  setUpNextIndex(ctx, user.id, (await readJson(req, upNextIndexSchema)).index);
  return json({ ok: true });
});

/** Adds one item or several, to play next or last. */
export const POST = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const body = await readJson(req, queueAddSchema);
  addToUpNext(ctx, user.id, "items" in body ? body.items : [body], body.at);
  return json(await getUpNext(ctx, user.id));
});
