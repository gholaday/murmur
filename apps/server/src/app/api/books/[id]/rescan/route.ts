import { requireAdmin } from "@/server/auth";
import { getContext } from "@/server/context";
import { json, route } from "@/server/http";
import { rescanBook } from "@/server/metadata/edits";

/** Reads this book's files again on a scan that starts now. Edits and matches are kept. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  rescanBook(ctx, (await params).id);
  return json({ started: true }, { status: 202 });
});
