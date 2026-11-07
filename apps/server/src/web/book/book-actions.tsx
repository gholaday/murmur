"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, useState } from "react";
import { toast } from "sonner";
import { bookListening, bookStarted, type BookSummary, errorText } from "@murmur/shared/client";
import { useAdmin } from "../admin";
import { MenuItem, MenuSep } from "../card-menu";
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
export const BookActionsContext = createContext<{ edit: (bookId: string, tab: EditTab) => void } | null>(null);

/** Book cards' menu actions, with the Edit dialog they open for admins. */
export function BookActions({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAdmin } = useAdmin();
  const [editing, setEditing] = useState<{ id: string; tab: EditTab } | null>(null);
  const actions = useMemo(() => ({ edit: (id: string, tab: EditTab) => setEditing({ id, tab }) }), []);
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
    </BookActionsContext.Provider>
  );
}

/**
 * A book's menu, the same on its card and its page: playing it, then for admins Edit, Match and
 * Mark as matched. Mounted only while open, so it follows the player cheaply.
 */
export function BookMenuItems({
  book,
  edit,
  choose,
}: {
  book: BookSummary;
  edit: (bookId: string, tab: EditTab) => void;
  choose: (fn: () => unknown) => () => void;
}) {
  const router = useRouter();
  const player = usePlayerControls();
  const { isAdmin } = useAdmin();
  const { current, playing, finished, canPlayNext, onPlayNext, markFinished, togglePlayNext } = useBookActions(book);

  return (
    <>
      <MenuItem onClick={choose(() => (current ? player.toggle() : player.playRef({ itemType: "book", itemId: book.id }, finished ? 0 : undefined)))}>
        {current && playing ? "Pause" : bookListening(book) ? "Continue" : "Play"}
      </MenuItem>
      {canPlayNext ? <MenuItem onClick={choose(togglePlayNext)}>{onPlayNext ? "Remove from Play next" : "Add to Play next"}</MenuItem> : null}
      <MenuItem onClick={choose(() => markFinished(!finished))}>{finished ? "Mark as not finished" : "Mark as finished"}</MenuItem>
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
        </>
      ) : null}
    </>
  );
}
