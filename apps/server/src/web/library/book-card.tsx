"use client";

import Link from "next/link";
import { memo, useContext } from "react";
import { apiPaths, type BookSummary, progressPct, timeLeft } from "@murmur/shared/client";
import { useAdmin } from "../admin";
import { BookActionsContext, BookMenuItems } from "../book/book-actions";
import { CardMenu } from "../card-menu";
import { Cover } from "../cover";
import { CheckIcon } from "../icons";
import { Mixer } from "../mixer";
import { useNowPlaying } from "../player/engine";
import { PickDisc, useSelection } from "./selection";

/**
 * A bigger Continue listening card: cover, progress, title, author and time left, with the same
 * menu as a book card. It can't be picked: while selecting, a tap does nothing and the menu hides.
 */
export function ContinueCard({ book: b }: { book: BookSummary }) {
  const actions = useContext(BookActionsContext);
  const selecting = !!useSelection()?.selecting;
  const { current, playing } = useNowPlaying((n) => n.type === "book" && n.id === b.id);
  return (
    <div
      className={`card continue-card${current ? " playing" : ""}`}
      onClickCapture={
        selecting
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
            }
          : undefined
      }
    >
      <Link href={`/book/${b.id}`} className="card-link">
        <div className="card-cover">
          <Cover
            src={b.coverHash ? apiPaths.coverUrl(b.id, b.coverHash, 600) : null}
            color={b.coverColor}
            title={b.title}
            subtitle={b.author}
            large
          />
          {current ? <Mixer playing={playing} /> : null}
        </div>
        <div className="bar thick">
          <div style={{ width: `${progressPct(b)}%` }} />
        </div>
        <div className="continue-text">
          <div className="card-title">{b.title}</div>
          {b.author ? <div className="card-sub">{b.author}</div> : null}
          <div className="card-sub">{timeLeft(b.durationSec, b.progress!.positionSec)}</div>
        </div>
      </Link>
      {actions && !selecting ? <CardMenu label={b.title} items={(choose) => <BookMenuItems book={b} edit={actions.edit} choose={choose} />} /> : null}
    </div>
  );
}

/** Memoized: a library has hundreds of cards, and typing in search re-renders the grid. */
export const BookCard = memo(function BookCard({ book, sub }: { book: BookSummary; sub?: string | null }) {
  const actions = useContext(BookActionsContext);
  const sel = useSelection();
  const selecting = !!sel?.selecting;
  const on = selecting && sel.picked.has(book.id);
  const { isAdmin } = useAdmin();
  const pct = progressPct(book);
  const started = !!book.progress && !book.progress.finished && pct > 0;
  const { current, playing } = useNowPlaying((n) => n.type === "book" && n.id === book.id);
  return (
    <div
      className={`card${current ? " playing" : ""}${selecting ? " selecting" : ""}${on ? " picked" : ""}`}
      // While selecting, a click picks the card instead of opening it; shift picks a run.
      onClickCapture={
        selecting
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              sel.pick(book.id, e.shiftKey);
            }
          : undefined
      }
    >
      <Link href={`/book/${book.id}`} className="card-link" aria-pressed={selecting ? on : undefined}>
        <div className="card-cover">
          <Cover
            src={book.coverHash ? apiPaths.coverUrl(book.id, book.coverHash, 200) : null}
            color={book.coverColor}
            title={book.title}
            subtitle={book.author}
          />
          {current ? <Mixer playing={playing} /> : null}
          {/* Admins see which books haven't been matched yet, where they can match them. */}
          {actions && isAdmin && !book.matched ? <span className="card-unmatched">Not matched</span> : null}
        </div>
        {started ? (
          <div className="bar" aria-hidden="true">
            <div style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        <div className="card-title">{book.title}</div>
        <div className="card-sub">{sub === undefined ? (book.author ?? "Unknown author") : sub}</div>
      </Link>
      {selecting ? (
        <PickDisc on={on} />
      ) : (
        <>
          {book.progress?.finished ? (
            <span className="card-done" aria-label="Finished">
              <CheckIcon size={14} />
            </span>
          ) : null}
          {actions ? <CardMenu label={book.title} items={(choose) => <BookMenuItems book={book} edit={actions.edit} choose={choose} />} /> : null}
        </>
      )}
    </div>
  );
});
