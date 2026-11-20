import { requireAdmin, requireUser } from "@/server/auth";
import { getBook } from "@/server/books";
import { getContext } from "@/server/context";
import { HttpError, json, jsonWithEtag, route } from "@/server/http";
import { removeBook } from "@/server/metadata/edits";

export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const book = await getBook(ctx, (await params).id, user.id);
  if (!book) throw new HttpError(404, "Book not found.");
  return jsonWithEtag(req, book);
});

/** Removes a book from the library (never its files). */
export const DELETE = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  requireAdmin(ctx, req);
  removeBook(ctx, (await params).id);
  return json({ removed: true });
});
