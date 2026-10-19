import { createUserSchema } from "@murmur/shared";
import { eq } from "drizzle-orm";
import { hashPassword, requireAdmin, toUserDto } from "@/server/auth";
import { getContext } from "@/server/context";
import { users } from "@/server/db/schema";
import { HttpError, json, readJson, route } from "@/server/http";

export const GET = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const rows = ctx.db.select().from(users).orderBy(users.username).all();
  return json(rows.map(toUserDto));
});

export const POST = route(async (req) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  const input = await readJson(req, createUserSchema);
  if (ctx.db.select({ id: users.id }).from(users).where(eq(users.username, input.username)).get()) {
    throw new HttpError(409, "That username is already taken.");
  }
  const created = ctx.db
    .insert(users)
    .values({
      username: input.username,
      passwordHash: await hashPassword(input.password),
      isAdmin: input.isAdmin,
      createdAt: Date.now(),
    })
    .returning()
    .get();
  return json(toUserDto(created), { status: 201 });
});
