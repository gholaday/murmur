import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";
import { addToPlayNext, removeFromPlayNext } from "@/server/play-next";

type Ctx = { params: Promise<{ id: string }> };

/** Adds the book to the end of your Play next shelf. */
export const POST = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  addToPlayNext(ctx, user.id, (await params).id);
  return json({ ok: true });
});

/** Takes the book off your Play next shelf. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  removeFromPlayNext(ctx, user.id, (await params).id);
  return json({ ok: true });
});
