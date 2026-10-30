import { watchDetailsSchema } from "@murmur/shared";
import { requireAdmin, requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, jsonWithEtag, readJson, route } from "@/server/http";
import { saveWatchDetails } from "@/server/watch/edit";
import { getShow } from "@/server/watch/queries";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const show = await getShow(ctx, user.id, (await params).id);
  if (!show) throw new HttpError(404, "Show not found.");
  return jsonWithEtag(req, show);
});

/** Edit: the title, year and description, which a later match leaves alone. */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  saveWatchDetails(ctx, "show", (await params).id, await readJson(req, watchDetailsSchema));
  return json({ ok: true });
});
