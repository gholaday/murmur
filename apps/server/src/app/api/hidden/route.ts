import { hiddenSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { hide, listHidden, unhide } from "@/server/hidden";
import { json, readJson, route } from "@/server/http";

/** HiddenDto: what you hid, by Library section. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return json(await listHidden(ctx, user.id));
});

/** Hides a book, album, artist, movie or show from your lists, shelves and search. */
export const PUT = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  hide(ctx, user.id, await readJson(req, hiddenSchema));
  return json({ ok: true });
});

/** Shows it again. */
export const DELETE = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  unhide(ctx, user.id, await readJson(req, hiddenSchema));
  return json({ ok: true });
});
