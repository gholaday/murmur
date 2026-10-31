import { matchApplySchema } from "@murmur/shared";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, queryText, readJson, route } from "@/server/http";
import { applyMatch, removeMatch, searchMatches } from "@/server/metadata/match";

type Ctx = { params: Promise<{ id: string }> };

/** Scored candidates; `?title=&author=` searches by hand instead of using the book's own details. */
export const GET = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const url = new URL(req.url);
  const result = await searchMatches(ctx, (await params).id, {
    title: queryText(url, "title"),
    author: queryText(url, "author"),
  });
  return json(result);
});

/** Applies the chosen fields from one candidate. */
export const POST = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  await applyMatch(ctx, (await params).id, await readJson(req, matchApplySchema));
  return json({ ok: true });
});

/** Forgets the match; the book shows its file metadata again. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  removeMatch(ctx, (await params).id);
  return json({ ok: true });
});
