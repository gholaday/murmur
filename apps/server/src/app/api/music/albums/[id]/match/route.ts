import { albumMatchApplySchema } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, readJson, route } from "@/server/http";
import { applyAlbumMatch, removeAlbumMatch, searchAlbumMatches } from "@/server/music/match";

type Ctx = { params: Promise<{ id: string }> };

/** Scored results; `?title=&artist=` searches by hand instead of using the album's own details. */
export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const url = new URL(req.url);
  const result = await searchAlbumMatches(ctx, (await params).id, {
    title: url.searchParams.get("title") ?? undefined,
    artist: url.searchParams.get("artist") ?? undefined,
  });
  return json(result);
});

/** Applies the chosen fields from one result. */
export const POST = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  await applyAlbumMatch(ctx, (await params).id, await readJson(req, albumMatchApplySchema));
  return json({ ok: true });
});

/** Forgets the match; the album shows what its files say again. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  removeAlbumMatch(ctx, (await params).id);
  return json({ ok: true });
});
