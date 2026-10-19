import { requireUser } from "@/server/auth";
import { getBook } from "@/server/books";
import { getContext } from "@/server/context";
import { HttpError, jsonWithEtag, route } from "@/server/http";

export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await getContext();
  const user = requireUser(ctx, req);
  const book = await getBook(ctx, (await params).id, user.id);
  if (!book) throw new HttpError(404, "Book not found.");
  return jsonWithEtag(req, book);
});
