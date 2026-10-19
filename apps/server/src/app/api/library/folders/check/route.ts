import { folderCheckSchema, type FolderCheckDto } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { checkFolder, normalizeFolder } from "@/server/library/folders";

/** Checks a folder before it's added: exists, readable, no overlap with the others. */
export const POST = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const { path, others } = await readJson(req, folderCheckSchema);
  const result: FolderCheckDto = await checkFolder(path, others.map(normalizeFolder));
  return json(result);
});
