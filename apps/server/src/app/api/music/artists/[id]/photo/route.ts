import { artistPhotoSchema } from "@murmur/shared";
import { requireAdmin, requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { coverResponse } from "@/server/cover-response";
import { json, readJson, route } from "@/server/http";
import { setArtistPhoto } from "@/server/music/match";
import { getArtistPhotoHash } from "@/server/music/queries";

type Ctx = { params: Promise<{ id: string }> };

/** The artist's photo, same caching as covers. */
export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  return coverResponse(req, getArtistPhotoHash(ctx, (await params).id));
});

/** Uses a photo from the options, or the newest album's cover when `providerId` is null. */
export const PUT = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const { providerId } = await readJson(req, artistPhotoSchema);
  await setArtistPhoto(ctx, (await params).id, providerId);
  return json({ ok: true });
});
