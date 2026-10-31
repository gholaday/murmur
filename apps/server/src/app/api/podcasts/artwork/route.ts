import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, route } from "@/server/http";
import { fetchArtwork } from "@/server/podcasts/artwork";

/** Artwork from search results and previews, fetched by the server (see artworkLink). */
export const GET = route(async (req) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  const params = new URL(req.url).searchParams;
  const url = params.get("u");
  const sig = params.get("s");
  if (!url || !sig) throw new HttpError(400, "Missing artwork link.");
  const { body, type } = await fetchArtwork(ctx.sqlite, url, sig);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=86400",
      // Never run as a page, whatever the publisher sent.
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
