import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, route } from "@/server/http";
import { folderList } from "@/server/library/folders";

type Ctx = { params: Promise<{ kind: string }> };

/** The movie or show folders, which come from what's mounted. */
export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const { kind } = await params;
  if (kind !== "movies" && kind !== "shows") throw new HttpError(404, "Not found.");
  return json(await folderList(ctx.db, ctx.sqlite, kind));
});
