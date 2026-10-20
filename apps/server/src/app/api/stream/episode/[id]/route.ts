import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { env } from "@/server/env";
import { HttpError, route } from "@/server/http";
import { getEpisodeForUser } from "@/server/podcasts/queries";
import { proxyStream, streamFile, streamGrowing } from "@/server/stream";

/**
 * Plays the server's copy of an episode, downloading it first if needed (playback reads the
 * file as it grows). Without a usable copy it relays the publisher's audio instead, so the
 * browser and phone only ever talk to the server.
 */
const handler = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const id = (await params).id;
  const ep = getEpisodeForUser(ctx.sqlite, id, user.id);
  if (!ep) throw new HttpError(404, "Episode not found.");
  const cached = await ctx.episodeCache.open(id).catch(() => null);
  if (cached?.kind === "ready") return streamFile(req, cached.file, cached.mimeType);
  if (cached?.kind === "growing") return streamGrowing(req, cached.file, cached.download, cached.mimeType);
  return proxyStream(req, ep.audioUrl, ep.mimeType ?? "audio/mpeg", `Murmur/${env.version}`);
});

export const GET = handler;
export const HEAD = handler;
