import { queueAddSchema, queueReplaceSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { addToQueue, getQueue, replaceQueue } from "@/server/queue";

export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return json(await getQueue(ctx, user.id));
});

/** Adds one item, to play next or last. */
export const POST = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const { at, ...ref } = await readJson(req, queueAddSchema);
  addToQueue(ctx, user.id, ref, at);
  return json(await getQueue(ctx, user.id));
});

/** Replaces the queue in one go: reorder, remove and clear. */
export const PUT = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  replaceQueue(ctx, user.id, (await readJson(req, queueReplaceSchema)).items);
  return json(await getQueue(ctx, user.id));
});
