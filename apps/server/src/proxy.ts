import { NextResponse } from "next/server";
import { CHANGES_HEADER, changesToken } from "@/server/changes";

/** Every API answer carries the change counts, so clients notice a scan on calls they make anyway. */
export function proxy() {
  const res = NextResponse.next();
  res.headers.set(CHANGES_HEADER, changesToken());
  return res;
}

export const config = { matcher: "/api/:path*" };
