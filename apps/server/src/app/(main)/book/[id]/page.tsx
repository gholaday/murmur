import { notFound } from "next/navigation";
import { getBook } from "@/server/books";
import { getContext } from "@/server/context";
import { requirePageUser } from "@/server/session";
import { BookView } from "@/web/book/book-view";

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const book = await getBook(await getContext(), (await params).id, user.id);
  if (!book) notFound();
  return <BookView book={book} isAdmin={user.isAdmin} />;
}
