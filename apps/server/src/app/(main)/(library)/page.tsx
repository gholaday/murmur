import { emptyLibraryReason, firstTab } from "@murmur/shared";
import { redirect } from "next/navigation";
import { listBooks } from "@/server/books";
import { getContext } from "@/server/context";
import { getPrefs } from "@/server/prefs";
import { requirePageUser } from "@/server/session";
import { Library } from "@/web/library/library";

export default async function LibraryPage() {
  const user = await requirePageUser();
  const ctx = await getContext();
  const prefs = getPrefs(ctx, user.id);
  // This is also where the app opens, so with Books hidden it goes to the first tab left.
  const first = firstTab(prefs.tabs);
  if (first !== "books") redirect(`/${first}`);
  const books = await listBooks(ctx, user.id);
  const emptyReason = emptyLibraryReason(ctx.scanState);
  // en-CA formats as YYYY-MM-DD in the server's time zone (TZ).
  const today = new Date().toLocaleDateString("en-CA");
  return (
    <Library books={books} emptyReason={emptyReason} today={today} sections={prefs.bookSections} />
  );
}
