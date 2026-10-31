import { NextResponse } from "next/server";
import { assertSameOrigin, deleteSession, SESSION_COOKIE, tokenFromRequest } from "@/server/auth";
import { getContext } from "@/server/context";
import { route } from "@/server/http";

export const POST = route(async (req) => {
  const ctx = await getContext();
  const found = tokenFromRequest(req);
  // Like every other write: another site's page can't sign you out with your cookie.
  if (found?.viaCookie) assertSameOrigin(req);
  if (found) deleteSession(ctx, found.token);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
