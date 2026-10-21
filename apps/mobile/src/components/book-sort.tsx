import { useSyncExternalStore } from "react";
import { BOOK_SORTS, type BookSort, LIBRARY_SORT_KEY } from "@murmur/shared/client";
import { getJson, setJson } from "@/lib/storage";
import { Sheet, SheetItem } from "./sheet";

// One saved sort shared by the Library tab and the All books screen, so changing it on one
// shows on the other.
let value: BookSort = getJson<BookSort>(LIBRARY_SORT_KEY) ?? "added";
const listeners = new Set<() => void>();

export function setBookSort(next: BookSort) {
  value = next;
  setJson(LIBRARY_SORT_KEY, next);
  listeners.forEach((l) => l());
}

export function useBookSort(): BookSort {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => value,
  );
}

export function BookSortSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sort = useBookSort();
  return (
    <Sheet open={open} onClose={onClose} title="Sort books">
      {BOOK_SORTS.map((s) => (
        <SheetItem
          key={s.id}
          label={s.label}
          active={sort === s.id}
          onPress={() => {
            setBookSort(s.id);
            onClose();
          }}
        />
      ))}
    </Sheet>
  );
}
