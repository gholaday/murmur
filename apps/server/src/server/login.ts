import type { LoginResponse, UserDto } from "@murmur/shared";
import { NextResponse } from "next/server";
import { createSession, isSecureRequest, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from "./auth";
import type { AppContext } from "./context";

/** Starts a session: web clients get an httpOnly cookie, the app gets a bearer token. */
export function signedInResponse(
  ctx: AppContext,
  req: Request,
  user: UserDto,
  client: "web" | "app",
  deviceName?: string,
): NextResponse {
  const token = createSession(ctx, user.id, client, deviceName);
  if (client === "app") return NextResponse.json<LoginResponse>({ user, token });
  const res = NextResponse.json<LoginResponse>({ user });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return res;
}
