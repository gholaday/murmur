import { notFound } from "next/navigation";
import { listBooks } from "@/server/books";
import { getContext } from "@/server/context";
import { listAlbums } from "@/server/music/queries";
import { requirePageUser } from "@/server/session";
import { type LibraryList, LibraryListView } from "@/web/profile/library-lists";

// Here rather than imported: a client module's values aren't readable on the server.
const LISTS: LibraryList[] = ["attention", "unmatched", "albums"];

/** Needs attention, or Not matched books or albums, opened from You > Library. Admins only. */
export default async function LibraryListPage({ params }: { params: Promise<{ list: string }> }) {
  const user = await requirePageUser();
  const list = (await params).list;
  if (!user.isAdmin || !LISTS.includes(list as LibraryList)) notFound();
  const ctx = await getContext();
  return (
    <LibraryListView
      list={list as LibraryList}
      books={list === "albums" ? [] : await listBooks(ctx, user.id)}
      albums={list === "albums" ? await listAlbums(ctx, user.id, "all", "artist") : []}
    />
  );
}
