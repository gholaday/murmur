import { requireUser } from "@/server/auth";
import { getContext } from "@/server/context";
import { coverResponse } from "@/server/cover-response";
import { route } from "@/server/http";

export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  requireUser(ctx, req);
  const row = ctx.sqlite.prepare("SELECT cover_hash FROM podcasts WHERE id = ?").get((await params).id) as
    | { cover_hash: string | null }
    | undefined;
  return coverResponse(req, row?.cover_hash ?? null);
});
