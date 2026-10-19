import { listBooks } from "@/server/books";
import { getContext } from "@/server/context";
import { requirePageUser } from "@/server/session";
import { Library } from "@/web/library/library";

export default async function LibraryPage() {
  const user = await requirePageUser();
  const ctx = await getContext();
  const books = await listBooks(ctx, user.id);
  const emptyReason = ctx.scanState.running
    ? "The first scan is running. Books appear as soon as it finishes."
    : (ctx.scanState.lastError ?? "Check that the library folder is mounted, then rescan from Profile.");
  return <Library books={books} emptyReason={emptyReason} />;
}
