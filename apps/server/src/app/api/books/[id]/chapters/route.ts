import { chaptersEditSchema } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { getEditInfo, saveChapters } from "@/server/metadata/edits";

/** Saves hand-edited chapters; `{ chapters: null }` goes back to the files' chapters. */
export const PUT = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const id = (await params).id;
  await saveChapters(ctx, id, await readJson(req, chaptersEditSchema));
  return json(await getEditInfo(ctx, id));
});
