import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";
import { getEditInfo } from "@/server/metadata/edits";

/** What the edit dialog needs: shown values, what the files say, chapters and files. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  return json(await getEditInfo(ctx, (await params).id));
});
