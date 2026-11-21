"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, useState } from "react";
import { toast } from "../toast";
import { apiPaths, bookListening, bookStarted, type BookSummary, errorText } from "@murmur/shared/client";
import { useAdmin } from "../admin";
import { api } from "../api";
import { RemoveBooksSheet, useSelection } from "../library/selection";
import { MenuItem, MenuSep } from "../card-menu";
import { HideMenuItem } from "../hidden";
import { useNowPlaying, usePlayerControls } from "../player/engine";
import { setFinished } from "../progress";
import { EditBookDialog, type EditTab } from "./edit-dialog";
import { setMarkedMatched } from "./match-mark";
import { setPlayNext } from "./play-next";

/**
 * What can be done to a book, the same from its card's menu and its page: whether it's the one
 * playing, marking it finished, and putting it on Play next.
 */
export function useBookActions(book: BookSummary) {
  const router = useRouter();
  const player = usePlayerControls();
  const { current, playing } = useNowPlaying((n) => n.type === "book" && n.id === book.id);
  // Playing a finished book starts it over, so while it's loaded it isn't finished.
  const finished = !!book.progress?.finished && !current;
  const onPlayNext = book.playNext !== null;
  return {
    current,
    playing,
    finished,
    onPlayNext,
    /** A started book is in Continue listening, so it can't go on Play next. */
    canPlayNext: !current && !bookStarted(book),
    async markFinished(done: boolean) {
      // The player saves the one it has loaded; the refresh below waits for either save.
      if (current) await player.markCurrent(done);
      else await setFinished("book", book.id, book.durationSec, done);
      toast(done ? "Marked as finished" : "Marked as not finished");
      router.refresh();
    },
    togglePlayNext() {
      void setPlayNext(book.id, !onPlayNext, () => router.refresh()).catch((err: unknown) => toast.error(errorText(err)));
    },
  };
}

/** Lets cards offer the options menu; BookActions provides it, with one shared edit dialog. */
export const BookActionsContext = createContext<{ edit: (bookId: string, tab: EditTab) => void; remove: (book: BookSummary) => void } | null>(null);

/** Removes a book from the library after its confirm; `after` runs once it's gone. */
export function useRemoveBook(after: () => void) {
  const [busy, setBusy] = useState(false);
  return {
    busy,
    remove: async (book: BookSummary) => {
      setBusy(true);
      try {
        await api(apiPaths.book(book.id), { method: "DELETE" });
        toast(`Removed ${book.title} from the library`);
        after();
      } catch (err) {
        toast.error(errorText(err));
      } finally {
        setBusy(false);
      }
    },
  };
}

/** Book cards' menu actions, with the Edit dialog and the Remove confirm they open for admins. */
export function BookActions({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAdmin } = useAdmin();
  const [editing, setEditing] = useState<{ id: string; tab: EditTab } | null>(null);
  const [removing, setRemoving] = useState<BookSummary | null>(null);
  const { busy, remove } = useRemoveBook(() => {
    setRemoving(null);
    router.refresh();
  });
  const actions = useMemo(() => ({ edit: (id: string, tab: EditTab) => setEditing({ id, tab }), remove: setRemoving }), []);
  return (
    <BookActionsContext.Provider value={actions}>
      {children}
      {isAdmin && editing ? (
        <EditBookDialog
          key={`${editing.id}:${editing.tab}`}
          bookId={editing.id}
          tab={editing.tab}
          open
          onClose={() => setEditing(null)}
          onChanged={() => router.refresh()}
        />
      ) : null}
      {isAdmin ? (
        <RemoveBooksSheet
          open={!!removing}
          books={removing ? [removing] : []}
          busy={busy}
          onConfirm={() => removing && void remove(removing)}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </BookActionsContext.Provider>
  );
}

/**
 * A book's menu, the same on its card and its page: playing it, Select (in a grid that can pick
 * several), Hide, then for admins Edit, Match, Mark as matched and Remove from library last.
 * Mounted only while open, so it follows the player cheaply.
 */
export function BookMenuItems({
  book,
  edit,
  remove,
  choose,
  after,
}: {
  book: BookSummary;
  edit: (bookId: string, tab: EditTab) => void;
  /** Opens Remove from library's confirm; the card's comes from BookActions. */
  remove?: (book: BookSummary) => void;
  choose: (fn: () => unknown) => () => void;
  /** Runs once the book is hidden: its own page goes back. */
  after?: () => void;
}) {
  const router = useRouter();
  const player = usePlayerControls();
  const { isAdmin } = useAdmin();
  const selection = useSelection();
  const actions = useContext(BookActionsContext);
  const onRemove = remove ?? actions?.remove;
  const { current, playing, finished, canPlayNext, onPlayNext, markFinished, togglePlayNext } = useBookActions(book);

  return (
    <>
      <MenuItem onClick={choose(() => (current ? player.toggle() : player.playRef({ itemType: "book", itemId: book.id }, finished ? 0 : undefined)))}>
        {current && playing ? "Pause" : bookListening(book) ? "Continue" : "Play"}
      </MenuItem>
      {canPlayNext ? <MenuItem onClick={choose(togglePlayNext)}>{onPlayNext ? "Remove from Play next" : "Add to Play next"}</MenuItem> : null}
      <MenuItem onClick={choose(() => markFinished(!finished))}>{finished ? "Mark as not finished" : "Mark as finished"}</MenuItem>
      {selection ? <MenuItem onClick={choose(() => selection.start(book.id))}>Select</MenuItem> : null}
      <HideMenuItem change={{ kind: "book", id: book.id }} title={book.title} choose={choose} after={after} divider={false} />
      {isAdmin ? (
        <>
          <MenuSep />
          <MenuItem onClick={choose(() => edit(book.id, "details"))}>Edit…</MenuItem>
          <MenuItem onClick={choose(() => edit(book.id, "match"))}>Match…</MenuItem>
          {/* Not offered once a real match was applied: Undo match is the way back there. */}
          {!book.matched || book.markedMatched ? (
            <MenuItem onClick={choose(() => setMarkedMatched(book.id, !book.markedMatched, () => router.refresh()))}>
              {book.markedMatched ? "Mark as not matched" : "Mark as matched"}
            </MenuItem>
          ) : null}
          {onRemove ? (
            <MenuItem danger onClick={choose(() => onRemove(book))}>
              Remove from library…
            </MenuItem>
          ) : null}
        </>
      ) : null}
    </>
  );
}
