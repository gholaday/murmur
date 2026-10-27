import { musicMineSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { addToMine, musicSummary, removeFromMine } from "@/server/music/queries";

/** Adds songs (or whole albums' songs) to your music; answers with the new counts. */
export const PUT = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  addToMine(ctx, user.id, await readJson(req, musicMineSchema));
  return json(musicSummary(ctx, user.id));
});

/** Takes songs (or whole albums' songs) out of your music. */
export const DELETE = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  removeFromMine(ctx, user.id, await readJson(req, musicMineSchema));
  return json(musicSummary(ctx, user.id));
});
