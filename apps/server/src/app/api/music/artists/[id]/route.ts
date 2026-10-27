import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, jsonWithEtag, route } from "@/server/http";
import { getArtist } from "@/server/music/queries";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  const artist = await getArtist(ctx, (await params).id);
  if (!artist) throw new HttpError(404, "Artist not found.");
  return jsonWithEtag(req, artist);
});
