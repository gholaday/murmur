import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, jsonWithEtag, route } from "@/server/http";
import { getAlbum } from "@/server/music/queries";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  const album = await getAlbum(ctx, (await params).id);
  if (!album) throw new HttpError(404, "Album not found.");
  return jsonWithEtag(req, album);
});
