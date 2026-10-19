import { progressBatchSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, jsonWithEtag, readJson, route } from "@/server/http";
import { listProgress, saveProgress } from "@/server/progress";

/** All progress for the signed-in user; `?since=<ms>` returns only newer changes. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0) || 0;
  return jsonWithEtag(req, listProgress(ctx, user.id, since));
});

/** Batched upsert; each item only applies if it is newer than what the server has. */
export const PUT = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const { items } = await readJson(req, progressBatchSchema);
  const applied = saveProgress(ctx, user.id, items);
  return json({ applied, received: items.length });
});
