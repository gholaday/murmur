import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, route } from "@/server/http";
import { getTrack } from "@/server/music/queries";

type Ctx = { params: Promise<{ id: string }> };

/** One song, for the player to pick up after a reload. */
export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const track = getTrack(ctx, user.id, (await params).id);
  if (!track) throw new HttpError(404, "Song not found.");
  return json(track);
});
