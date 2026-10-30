import { trackPlaySchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { addTrackPlay, recentTracks } from "@/server/music/queries";

/** The songs you played most recently, newest first. */
export const GET = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  return json(recentTracks(ctx, user.id));
});

/** Counts a play once a song has played long enough (see PLAY_COUNTS_AFTER_SEC). */
export const POST = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const body = await readJson(req, trackPlaySchema);
  addTrackPlay(ctx, user.id, body.trackId, body.source ?? null);
  return json({ ok: true });
});
