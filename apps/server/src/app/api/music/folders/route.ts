import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";
import { folderList } from "@/server/library/folders";

/** The music folders, which come from what's mounted. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  return json(await folderList(ctx.db, ctx.sqlite, "music"));
});
