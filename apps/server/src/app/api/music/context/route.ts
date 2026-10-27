import { playContextIndexSchema, playContextSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { clearPlayContext, getPlayContext, savePlayContext, setPlayContextIndex } from "@/server/music/queries";

/** What you're playing music from, with its songs, or null. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return json(getPlayContext(ctx, user.id));
});

/** Starts playing from an album, an artist or a list of songs. */
export const PUT = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  savePlayContext(ctx, user.id, await readJson(req, playContextSchema));
  return json(getPlayContext(ctx, user.id));
});

/** Moves on to another song in it. */
export const PATCH = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  setPlayContextIndex(ctx, user.id, (await readJson(req, playContextIndexSchema)).index);
  return json({ ok: true });
});

/** Music stopped, or a book or episode took over. */
export const DELETE = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  clearPlayContext(ctx, user.id);
  return json({ ok: true });
});
