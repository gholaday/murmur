import type { FolderBrowseDto } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, route } from "@/server/http";
import { browseFolder } from "@/server/library/folders";

/** Lists the subfolders of ?path= (the root when empty) for picking a library folder. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const path = new URL(req.url).searchParams.get("path") ?? "";
  try {
    const result: FolderBrowseDto = await browseFolder(path);
    return json(result);
  } catch {
    throw new HttpError(404, "The server can't open that folder.");
  }
});
