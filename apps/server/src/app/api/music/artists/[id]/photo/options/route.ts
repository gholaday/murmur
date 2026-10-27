import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";
import { artistPhotoOptions } from "@/server/music/match";

/** Photos to pick from, searched by the artist's name or `?q=`. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const q = new URL(req.url).searchParams.get("q") ?? undefined;
  return json(await artistPhotoOptions(ctx, (await params).id, q));
});
