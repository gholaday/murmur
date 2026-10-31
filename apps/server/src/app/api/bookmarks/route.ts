import { bookmarkBatchSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { listBookmarks, saveBookmarks } from "@/server/bookmarks";
import { getContext } from "@/server/context";
import { json, jsonWithEtag, readJson, route } from "@/server/http";

/** All your bookmarks; clients replace their list with this. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return jsonWithEtag(req, listBookmarks(ctx, user.id));
});

/** Batched upsert; each item only applies if it is newer than what the server has. */
export const PUT = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const { items } = await readJson(req, bookmarkBatchSchema);
  return json({ applied: saveBookmarks(ctx, user.id, items), received: items.length });
});
