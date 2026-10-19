import { loginSchema, setupSchema } from "@murmur/shared";
import { hashPassword, toUserDto, userCount } from "@/server/auth";
import { getContext } from "@/server/context";
import { users } from "@/server/db/schema";
import { HttpError, readJson, route } from "@/server/http";
import { signedInResponse } from "@/server/login";

const schema = setupSchema.extend({ client: loginSchema.shape.client, deviceName: loginSchema.shape.deviceName });

/** Creates the first account, which becomes the admin. Only works while there are no users. */
export const POST = route(async (req) => {
  const ctx = await getContext();
  const input = await readJson(req, schema);
  if (userCount(ctx) > 0) throw new HttpError(409, "Setup is already done. Sign in instead.");
  const passwordHash = await hashPassword(input.password);
  // Re-check inside the transaction so two simultaneous setup requests can't both win.
  const created = ctx.db.transaction((tx) => {
    if (userCount(ctx) > 0) throw new HttpError(409, "Setup is already done. Sign in instead.");
    return tx
      .insert(users)
      .values({ username: input.username, passwordHash, isAdmin: true, createdAt: Date.now() })
      .returning()
      .get();
  });
  return signedInResponse(ctx, req, toUserDto(created), input.client, input.deviceName);
});
