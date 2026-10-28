"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, memo, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { apiPaths, bookStarted, type BookSummary, errorText, progressPct } from "@murmur/shared/client";
import { api } from "../api";
import type { EditTab } from "../book/edit-dialog";
import { setMarkedMatched } from "../book/match-mark";
import { setPlayNext } from "../book/play-next";
import { Cover } from "../cover";
import { CheckIcon, MoreIcon } from "../icons";
import { Mixer } from "../mixer";
import { usePlayer } from "../player/engine";
import { setFinished } from "../progress";

/** Lets cards offer the options menu; the library provides it, with one shared edit dialog. */
export const BookActionsContext = createContext<{ isAdmin: boolean; edit: (bookId: string, tab: EditTab) => void } | null>(null);

/** Memoized: a library has hundreds of cards, and typing in search re-renders the grid. */
export const BookCard = memo(function BookCard({ book, sub }: { book: BookSummary; sub?: string | null }) {
  const actions = useContext(BookActionsContext);
  const pct = progressPct(book);
  const started = !!book.progress && !book.progress.finished && pct > 0;
  const player = usePlayer();
  const current = player.isCurrent("book", book.id);
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
          {current ? <Mixer playing={player.playing} /> : null}
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
      {actions ? <CardMenu book={book} isAdmin={actions.isAdmin} edit={actions.edit} /> : null}
    </div>
  );
});

function CardMenu({ book, isAdmin, edit }: { book: BookSummary; isAdmin: boolean; edit: (bookId: string, tab: EditTab) => void }) {
  // Where the menu sits on screen. It's rendered into <body> so a scrolling shelf doesn't clip it.
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  const open = pos !== null;
  const setOpen = (o: boolean) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!o || !r) return setPos(null);
    // Right-aligned to the dots, kept on screen, and opening upward in the lower part of the page.
    const left = Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    const up = r.bottom > window.innerHeight * 0.55;
    setPos(up ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
  };
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!wrap.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    // The menu is fixed, so it would drift away from its card on scroll.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div className="card-menu" ref={wrap}>
      <button
        type="button"
        className="card-dots"
        aria-label={`Options for ${book.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreIcon size={18} />
      </button>
      {pos ? createPortal(
        <div ref={menu} className="menu" role="menu" aria-label={`${book.title} options`} style={{ top: "auto", ...pos, position: "fixed", right: "auto", width: MENU_WIDTH }}>
          <CardMenuItems book={book} isAdmin={isAdmin} edit={edit} close={() => setOpen(false)} />
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

/**
 * The menu's contents, mounted only while it's open, so only an open menu follows the
 * player; otherwise every card in the library re-rendered on each play, pause and queue change.
 */
function CardMenuItems({
  book,
  isAdmin,
  edit,
  close,
}: {
  book: BookSummary;
  isAdmin: boolean;
  edit: (bookId: string, tab: EditTab) => void;
  close: () => void;
}) {
  const router = useRouter();
  const player = usePlayer();
  const finished = !!book.progress?.finished;
  const current = player.isCurrent("book", book.id);

  const choose = (fn: () => unknown) => () => {
    close();
    void Promise.resolve(fn()).catch((err: unknown) => toast.error(errorText(err)));
  };

  return (
    <>
      <button
        type="button"
        role="menuitem"
        onClick={choose(() => (current ? player.toggle() : player.playRef({ itemType: "book", itemId: book.id }, finished ? 0 : undefined)))}
      >
        {current && player.playing ? "Pause" : started(book) ? "Continue" : "Play"}
      </button>
      {/* Started books are in Continue listening instead. */}
      {!current && !bookStarted(book) ? (
        <button type="button" role="menuitem" onClick={choose(() => setPlayNext(book.id, book.playNext === null, () => router.refresh()))}>
          {book.playNext === null ? "Add to Play next" : "Remove from Play next"}
        </button>
      ) : null}
      <button
        type="button"
        role="menuitem"
        onClick={choose(async () => {
          if (current) player.markCurrent(!finished);
          await setFinished("book", book.id, book.durationSec, !finished);
          toast(finished ? "Marked as not finished" : "Marked as finished");
          router.refresh();
        })}
      >
        {finished ? "Mark as not finished" : "Mark as finished"}
      </button>
      {isAdmin ? (
        <>
          <div className="menu-sep" role="separator" />
          <button type="button" role="menuitem" onClick={choose(() => edit(book.id, "details"))}>
            Edit details…
          </button>
          <button type="button" role="menuitem" onClick={choose(() => edit(book.id, "cover"))}>
            Change cover…
          </button>
          <button type="button" role="menuitem" onClick={choose(() => edit(book.id, "match"))}>
            Match metadata…
          </button>
          {/* Not offered once a real match was applied: Undo match is the way back there. */}
          {!book.matched || book.markedMatched ? (
            <button type="button" role="menuitem" onClick={choose(() => setMarkedMatched(book.id, !book.markedMatched, () => router.refresh()))}>
              {book.markedMatched ? "Mark as not matched" : "Mark as matched"}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={choose(async () => {
              await api(`/api/books/${book.id}/rescan`, { method: "POST" });
              toast("Rescanning. Changes show in a moment.");
              setTimeout(() => router.refresh(), 3000);
            })}
          >
            Rescan files
          </button>
        </>
      ) : null}
    </>
  );
}

const MENU_WIDTH = 220;

const started = (b: BookSummary) => !!b.progress && !b.progress.finished && b.progress.positionSec > 5;
