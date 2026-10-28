import { archiveSchema } from "@murmur/shared";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, readJson, route } from "@/server/http";
import { getEpisodeForUser } from "@/server/podcasts/queries";
import { dropWaitingEpisode } from "@/server/up-next";

/** Archiving hides an episode from your lists without touching anyone else's. */
export const PUT = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const id = (await params).id;
  if (!getEpisodeForUser(ctx.sqlite, id, user.id)) throw new HttpError(404, "Episode not found.");
  const { archived } = await readJson(req, archiveSchema);
  if (archived) {
    ctx.sqlite
      .prepare("INSERT OR IGNORE INTO episode_archives (user_id, episode_id, archived_at) VALUES (?, ?, ?)")
      .run(user.id, id, Date.now());
    dropWaitingEpisode(ctx, user.id, id);
  } else {
    ctx.sqlite.prepare("DELETE FROM episode_archives WHERE user_id = ? AND episode_id = ?").run(user.id, id);
  }
  return json({ ok: true, archived });
});
