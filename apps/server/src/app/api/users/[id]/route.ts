import { count, eq } from "drizzle-orm";
import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { users } from "@/server/db/schema";
import { HttpError, json, route } from "@/server/http";

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  const admin = requireAdmin(ctx, req);
  const id = Number((await params).id);
  if (id === admin.id) throw new HttpError(400, "You can't delete your own account.");
  const target = ctx.db.select().from(users).where(eq(users.id, id)).get();
  if (!target) throw new HttpError(404, "User not found.");
  if (target.isAdmin) {
    const admins = ctx.db.select({ n: count() }).from(users).where(eq(users.isAdmin, true)).get()?.n ?? 0;
    if (admins <= 1) throw new HttpError(400, "There must always be at least one admin.");
  }
  ctx.db.delete(users).where(eq(users.id, id)).run(); // sessions and progress cascade
  return json({ ok: true });
});
