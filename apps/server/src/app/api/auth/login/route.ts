import { eq } from "drizzle-orm";
import { loginSchema } from "@murmur/shared";
import { dummyPasswordHash, toUserDto, verifyPassword } from "@/server/auth";
import { getContext } from "@/server/context";
import { users } from "@/server/db/schema";
import { HttpError, readJson, route } from "@/server/http";
import { signedInResponse } from "@/server/login";
import { assertSignInAllowed, clientAddress, recordSignInFailure } from "@/server/rate-limit";

export const POST = route(async (req) => {
  const ctx = await getContext();
  const input = await readJson(req, loginSchema);
  const address = clientAddress(req);
  assertSignInAllowed(input.username, address);
  const user = ctx.db.select().from(users).where(eq(users.username, input.username)).get();
  const ok = await verifyPassword(user?.passwordHash ?? (await dummyPasswordHash()), input.password);
  if (!user || !ok) {
    recordSignInFailure(input.username, address);
    throw new HttpError(401, "Wrong username or password.");
  }
  return signedInResponse(ctx, req, toUserDto(user), input.client, input.deviceName);
});
