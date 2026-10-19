import { requireUser } from "@/server/auth";
import { getCoverHash } from "@/server/books";
import { getContext } from "@/server/context";
import { coverResponse } from "@/server/cover-response";
import { route } from "@/server/http";

export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  return coverResponse(req, getCoverHash(ctx, (await params).id));
});
