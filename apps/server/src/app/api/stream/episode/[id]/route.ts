import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { env } from "@/server/env";
import { HttpError, route } from "@/server/http";
import { getEpisodeForUser } from "@/server/podcasts/queries";
import { proxyStream } from "@/server/stream";

/** Relays the publisher's audio, so the browser and phone only ever talk to the server. */
const handler = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const ep = getEpisodeForUser(ctx.sqlite, (await params).id, user.id);
  if (!ep) throw new HttpError(404, "Episode not found.");
  return proxyStream(req, ep.audioUrl, ep.mimeType ?? "audio/mpeg", `Murmur/${env.version}`);
});

export const GET = handler;
export const HEAD = handler;
