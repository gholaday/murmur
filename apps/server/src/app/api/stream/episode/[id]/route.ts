import fs from "node:fs";
import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { env } from "@/server/env";
import { HttpError, route } from "@/server/http";
import { mimeTypeFor } from "@/server/library/parse";
import { getEpisodeForUser } from "@/server/podcasts/queries";
import { proxyStream, resolveInside, streamFile } from "@/server/stream";

/** Plays the NAS copy when the episode is downloaded, otherwise relays the publisher's audio. */
const handler = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const ep = getEpisodeForUser(ctx.sqlite, (await params).id, user.id);
  if (!ep) throw new HttpError(404, "Episode not found.");
  if (ep.localPath) {
    const file = resolveInside(env.podcastsDir, ep.localPath);
    // A download that has gone missing (data folder moved or pruned by hand) falls back to the
    // publisher; the next feed check downloads it again.
    if (fs.existsSync(file)) return streamFile(req, file, ep.mimeType ?? mimeTypeFor(ep.localPath));
  }
  return proxyStream(req, ep.audioUrl, ep.mimeType ?? "audio/mpeg", `Murmur/${env.version}`);
});

export const GET = handler;
export const HEAD = handler;
