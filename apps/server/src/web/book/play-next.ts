import { apiPaths, errorText } from "@murmur/shared/client";
import { toast } from "sonner";
import { api } from "../api";

/**
 * Adds a book to your Play next shelf or takes it off, with an Undo.
 * `done` runs after each change, to refresh whatever shows the book.
 */
export async function setPlayNext(bookId: string, on: boolean, done: () => void) {
  const path = apiPaths.bookPlayNext(bookId);
  await api(path, { method: on ? "POST" : "DELETE" });
  done();
  toast(on ? "Added to Play next" : "Removed from Play next", {
    action: {
      label: "Undo",
      onClick: () => void api(path, { method: on ? "DELETE" : "POST" }).then(done, (err: unknown) => toast.error(errorText(err))),
    },
  });
}
