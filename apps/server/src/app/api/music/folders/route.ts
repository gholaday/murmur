import { musicFoldersSchema } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, readJson, route } from "@/server/http";
import { allFolderPaths, checkFolder, folderList, normalizeFolder } from "@/server/library/folders";

export const GET = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  return json(await folderList(ctx.db, ctx.sqlite, "music"));
});

/** Replaces the music folder list; empty turns music off. A rescan starts afterwards. */
export const PUT = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const { paths } = await readJson(req, musicFoldersSchema);
  const normalized = [...new Set(paths.map(normalizeFolder))];
  const otherFolders = allFolderPaths(ctx.db)
    .filter((f) => f.kind !== "music")
    .map((f) => f.path);
  for (const [i, p] of normalized.entries()) {
    const check = await checkFolder(p, [...normalized.filter((_, j) => j !== i), ...otherFolders]);
    if (!check.ok) throw new HttpError(400, `${check.path}: ${check.message}`);
  }
  await ctx.music.saveFolders(normalized);
  return json(await folderList(ctx.db, ctx.sqlite, "music"));
});
