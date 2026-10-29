import { errorText } from "@murmur/shared/client";
import { toast } from "sonner";
import { api } from "../api";

/**
 * Marks a book as needing no match, or lists it under Not matched again, with an Undo.
 * `done` runs after each change, to refresh whatever shows the book.
 */
export async function setMarkedMatched(bookId: string, marked: boolean, done: () => void) {
  const path = `/api/books/${bookId}/match/marked`;
  await api(path, { method: marked ? "POST" : "DELETE" });
  done();
  toast(marked ? "Marked as matched" : "Marked as not matched", {
    action: {
      label: "Undo",
      onClick: () => void api(path, { method: marked ? "DELETE" : "POST" }).then(done, (err: unknown) => toast.error(errorText(err))),
    },
  });
}
