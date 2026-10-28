import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, jsonWithEtag, route } from "@/server/http";
import { getShow } from "@/server/watch/queries";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const show = await getShow(ctx, user.id, (await params).id);
  if (!show) throw new HttpError(404, "Show not found.");
  return jsonWithEtag(req, show);
});
