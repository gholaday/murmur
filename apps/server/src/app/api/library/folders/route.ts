import { libraryFoldersSchema } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, readJson, route } from "@/server/http";
import { checkFolder, folderList, normalizeFolder } from "@/server/library/folders";

export const GET = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  return json(await folderList(ctx.db, ctx.sqlite));
});

/** Replaces the folder list. Every folder must pass the check; a rescan starts afterwards. */
export const PUT = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const { paths } = await readJson(req, libraryFoldersSchema);
  const normalized = [...new Set(paths.map(normalizeFolder))];
  for (const [i, p] of normalized.entries()) {
    const check = await checkFolder(p, normalized.filter((_, j) => j !== i));
    if (!check.ok) throw new HttpError(400, `${check.path}: ${check.message}`);
  }
  await ctx.library.saveFolders(normalized);
  return json(await folderList(ctx.db, ctx.sqlite));
});
