import { requireUser } from "@/server/auth";
import { deleteBookmark } from "@/server/bookmarks";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  deleteBookmark(ctx, user.id, (await params).id);
  return json({ ok: true });
});
