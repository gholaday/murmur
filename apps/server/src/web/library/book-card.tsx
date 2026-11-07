"use client";

import Link from "next/link";
import { memo, useContext } from "react";
import { apiPaths, type BookSummary, progressPct } from "@murmur/shared/client";
import { useAdmin } from "../admin";
import { BookActionsContext, BookMenuItems } from "../book/book-actions";
import { CardMenu } from "../card-menu";
import { Cover } from "../cover";
import { CheckIcon } from "../icons";
import { Mixer } from "../mixer";
import { useNowPlaying } from "../player/engine";

/** Memoized: a library has hundreds of cards, and typing in search re-renders the grid. */
export const BookCard = memo(function BookCard({ book, sub }: { book: BookSummary; sub?: string | null }) {
  const actions = useContext(BookActionsContext);
  const { isAdmin } = useAdmin();
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
      {book.progress?.finished ? (
        <span className="card-done" aria-label="Finished">
          <CheckIcon size={14} />
        </span>
      ) : null}
      {actions ? <CardMenu label={book.title} items={(choose) => <BookMenuItems book={book} edit={actions.edit} choose={choose} />} /> : null}
    </div>
  );
});
