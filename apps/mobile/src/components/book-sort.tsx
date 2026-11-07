import { BOOK_SORTS, type BookSort, storageKeys } from "@murmur/shared/client";
import { createSavedStore } from "@/lib/store";
import { Sheet, SheetItem } from "./sheet";

// One saved sort shared by the Library tab and the All books screen, so changing it on one
// shows on the other.
const sortStore = createSavedStore<BookSort>(storageKeys.librarySort,"added");

const setBookSort =sortStore.set;

export const useBookSort = sortStore.useValue;

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
