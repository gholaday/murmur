import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { route } from "@/server/http";
import { streamResponse } from "@/server/watch/video-addon";

type Ctx = { params: Promise<{ session: string; file: string }> };

/** A stream's playlists or one of its pieces, from the video add-on. */
export const GET = route<Ctx>(async (req, { params }) => {
  const user = requireUser(await getContext(), req);
  const { session, file } = await params;
  return streamResponse(req, String(user.id), session, file);
});
