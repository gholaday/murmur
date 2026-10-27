import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";
import { setMarkedMatched } from "@/server/metadata/match";

type Ctx = { params: Promise<{ id: string }> };

/** Marks the book as needing no match, so it leaves Not matched. */
export const POST = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  setMarkedMatched(ctx, (await params).id, true);
  return json({ ok: true });
});

/** Lists the book under Not matched again. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  setMarkedMatched(ctx, (await params).id, false);
  return json({ ok: true });
});
