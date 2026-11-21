import { bookBulkSchema } from "@murmur/shared";
import { requireAdmin, requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { hide } from "@/server/hidden";
import { json, readJson, route } from "@/server/http";
import { removeBooks, saveBulkDetails } from "@/server/metadata/edits";

/** Hides, edits or removes several picked books at once. Hide is anyone's; edit and remove are admin. */
export const POST = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const input = await readJson(req, bookBulkSchema);
  if (input.action === "hide") {
    ctx.sqlite.transaction(() => input.ids.forEach((id) => hide(ctx, user.id, { kind: "book", id })))();
  } else {
    requireAdmin(ctx, req);
    if (input.action === "edit") saveBulkDetails(ctx, input.ids, input.fields);
    else removeBooks(ctx, input.ids);
  }
  return json({ ok: true, count: input.ids.length });
});
