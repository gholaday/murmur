import { type NextRequest, NextResponse } from "next/server";
import { CAST_HEADER, CAST_PATH } from "@/server/cast";
import { CHANGES_HEADER, changesToken } from "@/server/changes";

/**
 * Every API answer carries the change counts, so clients notice a scan on calls they make anyway.
 * A Chromecast's link (`/api/cast/<token>/api/...`) is served as the API path it holds, with the
 * token passed along for requireUser to check; Google's player fetches from its own origin.
 */
export function proxy(req: NextRequest) {
  const cast = CAST_PATH.exec(req.nextUrl.pathname);
  if (cast) {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Range", "Access-Control-Expose-Headers": "Content-Length, Content-Range" };
    if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: cors });
    const headers = new Headers(req.headers);
    headers.set(CAST_HEADER, cast[1]!);
    const url = req.nextUrl.clone();
    url.pathname = cast[2]!;
    const res = NextResponse.rewrite(url, { request: { headers } });
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  }
  const res = NextResponse.next();
  res.headers.set(CHANGES_HEADER, changesToken());
  return res;
}

export const config = { matcher: "/api/:path*" };
