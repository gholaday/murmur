import { bookEditSchema } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { getEditInfo, saveDetails } from "@/server/metadata/edits";

/** Saves hand-edited details. The files are never changed. */
export const PUT = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const id = (await params).id;
  saveDetails(ctx, id, await readJson(req, bookEditSchema));
  return json(await getEditInfo(ctx, id));
});
