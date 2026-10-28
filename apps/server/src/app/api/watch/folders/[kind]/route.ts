import { musicFoldersSchema } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, readJson, route } from "@/server/http";
import { allFolderPaths, checkFolder, folderList, normalizeFolder } from "@/server/library/folders";

type Ctx = { params: Promise<{ kind: string }> };

async function folderKind(params: Ctx["params"]): Promise<"movies" | "shows"> {
  const { kind } = await params;
  if (kind !== "movies" && kind !== "shows") throw new HttpError(404, "Not found.");
  return kind;
}

export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  return json(await folderList(ctx.db, ctx.sqlite, await folderKind(params)));
});

/** Replaces the movies or shows folder list; with neither, Watch is off. A rescan starts afterwards. */
export const PUT = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const kind = await folderKind(params);
  const { paths } = await readJson(req, musicFoldersSchema);
  const normalized = [...new Set(paths.map(normalizeFolder))];
  const otherFolders = allFolderPaths(ctx.db)
    .filter((f) => f.kind !== kind)
    .map((f) => f.path);
  for (const [i, p] of normalized.entries()) {
    const check = await checkFolder(p, [...normalized.filter((_, j) => j !== i), ...otherFolders]);
    if (!check.ok) throw new HttpError(400, `${check.path}: ${check.message}`);
  }
  await ctx.watch.saveFolders(kind, normalized);
  return json(await folderList(ctx.db, ctx.sqlite, kind));
});
