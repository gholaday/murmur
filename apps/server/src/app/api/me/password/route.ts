import { changePasswordSchema } from "@murmur/shared";
import { deleteOtherSessions, hashPassword, requireUser, tokenFromRequest, verifyPassword } from "@/server/auth";
import { getContext } from "@/server/context";
import { HttpError, json, readJson, route } from "@/server/http";

/** Changes your password and signs out every other device. */
export const PUT = route(async (req) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const { currentPassword, newPassword } = await readJson(req, changePasswordSchema);
  const row = ctx.sqlite.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as { password_hash: string };
  if (!(await verifyPassword(row.password_hash, currentPassword))) throw new HttpError(400, "Current password is wrong.");
  ctx.sqlite.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(newPassword), user.id);
  const current = tokenFromRequest(req);
  if (current) deleteOtherSessions(ctx, user.id, current.token);
  return json({ ok: true });
});
