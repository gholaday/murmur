import { notFound } from "next/navigation";
import { listBookmarks } from "@/server/bookmarks";
import { getBook } from "@/server/books";
import { getContext } from "@/server/context";
import { requirePageUser } from "@/server/session";
import { BookView } from "@/web/book/book-view";

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const ctx = await getContext();
  const book = await getBook(ctx, (await params).id, user.id);
  if (!book) notFound();
  const bookmarks = listBookmarks(ctx, user.id).filter((b) => b.itemType === "book" && b.itemId === book.id);
  return <BookView book={book} bookmarks={bookmarks} isAdmin={user.isAdmin} />;
}
