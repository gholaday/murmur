"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiPaths, type BookSummary } from "@murmur/shared";
import { api } from "../api";
import type { EditTab } from "../book/edit-dialog";
import { Cover } from "../cover";
import { CheckIcon, MoreIcon } from "../icons";
import { usePlayer } from "../player/engine";
import { setFinished } from "../progress";

export function progressPct(b: BookSummary): number {
  if (!b.progress || b.durationSec <= 0) return 0;
  return Math.min(100, (b.progress.positionSec / b.durationSec) * 100);
}

/** Lets cards offer the options menu; the library provides it, with one shared edit dialog. */
export const BookActionsContext = createContext<{ isAdmin: boolean; edit: (bookId: string, tab: EditTab) => void } | null>(null);

export function BookCard({ book, sub }: { book: BookSummary; sub?: string | null }) {
  const actions = useContext(BookActionsContext);
  const pct = progressPct(book);
  const started = !!book.progress && !book.progress.finished && pct > 0;
  return (
    <div className="card">
      <Link href={`/book/${book.id}`} className="card-link">
        <Cover
          src={book.coverHash ? apiPaths.coverUrl(book.id, book.coverHash, 200) : null}
          color={book.coverColor}
          title={book.title}
          subtitle={book.author}
        />
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
}

function CardMenu({ book, isAdmin, edit }: { book: BookSummary; isAdmin: boolean; edit: (bookId: string, tab: EditTab) => void }) {
  const router = useRouter();
  const player = usePlayer();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const finished = !!book.progress?.finished;
  const current = player.isCurrent("book", book.id);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    wrap.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const choose = (fn: () => unknown) => () => {
    setOpen(false);
    void Promise.resolve(fn()).catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Something went wrong."));
  };

  return (
    <div className="card-menu" ref={wrap}>
      <button
        type="button"
        className="card-dots"
        aria-label={`Options for ${book.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreIcon size={18} />
      </button>
      {open ? (
        <div className="menu" role="menu" aria-label={`${book.title} options`}>
          <button
            type="button"
            role="menuitem"
            onClick={choose(() => (current ? player.toggle() : player.playRef({ itemType: "book", itemId: book.id }, finished ? 0 : undefined)))}
          >
            {current && player.playing ? "Pause" : started(book) ? "Continue" : "Play"}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={current}
            onClick={choose(async () => {
              await player.queueAdd({ itemType: "book", itemId: book.id }, "last");
              toast("Added to Up Next");
            })}
          >
            Add to Up Next
          </button>
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
        </div>
      ) : null}
    </div>
  );
}

const started = (b: BookSummary) => !!b.progress && !b.progress.finished && b.progress.positionSec > 5;
