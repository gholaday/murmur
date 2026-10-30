"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, memo, useContext } from "react";
import { toast } from "sonner";
import { apiPaths, bookListening, bookStarted, type BookSummary, progressPct } from "@murmur/shared/client";
import type { EditTab } from "../book/edit-dialog";
import { setMarkedMatched } from "../book/match-mark";
import { setPlayNext } from "../book/play-next";
import { CardMenu, MenuItem, MenuSep } from "../card-menu";
import { Cover } from "../cover";
import { CheckIcon } from "../icons";
import { Mixer } from "../mixer";
import { useNowPlaying, usePlayer } from "../player/engine";
import { setFinished } from "../progress";

/** Lets cards offer the options menu; the library provides it, with one shared edit dialog. */
export const BookActionsContext = createContext<{ isAdmin: boolean; edit: (bookId: string, tab: EditTab) => void } | null>(null);

/** Memoized: a library has hundreds of cards, and typing in search re-renders the grid. */
export const BookCard = memo(function BookCard({ book, sub }: { book: BookSummary; sub?: string | null }) {
  const actions = useContext(BookActionsContext);
  const pct = progressPct(book);
  const started = !!book.progress && !book.progress.finished && pct > 0;
  const { current, playing } = useNowPlaying((n) => n.type === "book" && n.id === book.id);
  return (
    <div className={`card${current ? " playing" : ""}`}>
      <Link href={`/book/${book.id}`} className="card-link">
        <div className="card-cover">
          <Cover
            src={book.coverHash ? apiPaths.coverUrl(book.id, book.coverHash, 200) : null}
            color={book.coverColor}
            title={book.title}
            subtitle={book.author}
          />
          {current ? <Mixer playing={playing} /> : null}
          {/* Admins see which books haven't been matched yet. */}
          {actions?.isAdmin && !book.matched ? <span className="card-unmatched">Not matched</span> : null}
        </div>
        {started ? (
          <div className="bar" aria-hidden="true">
            <div style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        <div className="card-title">{book.title}</div>
        <div className="card-sub">{sub === undefined ? (book.author ?? "Unknown author") : sub}</div>
      </Link>
      {book.progress?.finished ? (
        <span className="card-done" aria-label="Finished">
          <CheckIcon size={14} />
        </span>
      ) : null}
      {actions ? (
        <CardMenu label={book.title} items={(choose) => <BookMenuItems book={book} isAdmin={actions.isAdmin} edit={actions.edit} choose={choose} />} />
      ) : null}
    </div>
  );
});

/**
 * A book's menu, the same on its card and its page: playing it, then for admins Edit, Match and
 * Mark as matched. Mounted only while open, so it follows the player cheaply.
 */
export function BookMenuItems({
  book,
  isAdmin,
  edit,
  choose,
}: {
  book: BookSummary;
  isAdmin: boolean;
  edit: (bookId: string, tab: EditTab) => void;
  choose: (fn: () => unknown) => () => void;
}) {
  const router = useRouter();
  const player = usePlayer();
  const finished = !!book.progress?.finished;
  const current = player.isCurrent("book", book.id);

  return (
    <>
      <MenuItem onClick={choose(() => (current ? player.toggle() : player.playRef({ itemType: "book", itemId: book.id }, finished ? 0 : undefined)))}>
        {current && player.playing ? "Pause" : bookListening(book) ? "Continue" : "Play"}
      </MenuItem>
      {/* Started books are in Continue listening instead. */}
      {!current && !bookStarted(book) ? (
        <MenuItem onClick={choose(() => setPlayNext(book.id, book.playNext === null, () => router.refresh()))}>
          {book.playNext === null ? "Add to Play next" : "Remove from Play next"}
        </MenuItem>
      ) : null}
      <MenuItem
        onClick={choose(async () => {
          if (current) await player.markCurrent(!finished);
          else await setFinished("book", book.id, book.durationSec, !finished);
          toast(finished ? "Marked as not finished" : "Marked as finished");
          router.refresh();
        })}
      >
        {finished ? "Mark as not finished" : "Mark as finished"}
      </MenuItem>
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
