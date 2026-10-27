import { trackPlaySchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { addTrackPlay } from "@/server/music/queries";

/** Counts a play once a song has played long enough (see PLAY_COUNTS_AFTER_SEC). */
export const POST = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  addTrackPlay(ctx, user.id, (await readJson(req, trackPlaySchema)).trackId);
  return json({ ok: true });
});
