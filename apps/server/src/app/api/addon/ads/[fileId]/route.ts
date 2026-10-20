import { addonReportSchema } from "@murmur/shared";
import { applyReport, requireAddon } from "@/server/ads";
import { getContext } from "@/server/context";
import { HttpError, json, readJson, route } from "@/server/http";

/** The add-on's progress, result, deferral or failure for one scan. */
export const POST = route<{ params: Promise<{ fileId: string }> }>(async (req, { params }) => {
  requireAddon(req);
  const fileId = Number((await params).fileId);
  if (!Number.isInteger(fileId)) throw new HttpError(400, "Bad file id.");
  const ctx = await getContext();
  applyReport(ctx.sqlite, fileId, await readJson(req, addonReportSchema));
  return json({ ok: true });
});
