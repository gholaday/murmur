"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { apiPaths, type BookDetail, type BookmarkDto, chapterAt, duration, FALLBACK_TINT, pastStart, plural, timeLeft } from "@murmur/shared/client";
import { useAdmin } from "../admin";
import { BookmarkRows } from "../bookmark-rows";
import { useBookmarks } from "../bookmarks";
import { MenuSheet } from "../card-menu";
import { ChapterList } from "../chapter-list";
import { Cover } from "../cover";
import { CheckIcon, PauseIcon, PlayIcon, QueueAddIcon } from "../icons";
import { bookToPlayable, usePlayerControls, usePlayerSelect, usePosition } from "../player/engine";
import { Description, HeroBar, SectionTitle } from "../ui";
import { BookMenuItems, useBookActions } from "./book-actions";
import { EditBookDialog, type EditTab } from "./edit-dialog";

export function BookView({ book, bookmarks: firstBookmarks }: { book: BookDetail; bookmarks: BookmarkDto[] }) {
  const router = useRouter();
  const player = usePlayerControls();
  const { isAdmin } = useAdmin();
  const bookmarks = useBookmarks("book", book.id, firstBookmarks);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState<EditTab | null>(null);
  const { current, playing, finished, canPlayNext, onPlayNext, markFinished, togglePlayNext } = useBookActions(book);
  const loading = usePlayerSelect((p) => current && p.loading);

  // Only follow the playhead while this book is the one playing.
  const livePosition = usePosition(current);
  const position = current ? livePosition : book.progress && !book.progress.finished ? book.progress.positionSec : 0;
  const started = pastStart(position);
  const pct = book.durationSec ? Math.min(100, (position / book.durationSec) * 100) : 0;
  const currentChapter = started || current ? chapterAt(book.chapters, position) : -1;
  const playChapter = useCallback((startSec: number) => player.play(bookToPlayable(book), startSec), [player, book]);

  // Starting the book opens the full player; pausing and resuming leave it as it is.
  const onPlay = () => {
    if (current) return player.toggle();
    player.play(bookToPlayable(book), finished ? 0 : undefined);
    player.setExpanded(true);
  };

  const left = timeLeft(book.durationSec, position);
  const [playLabel, playSub] = current
    ? [playing ? "Pause" : "Resume", left]
    : finished
      ? ["Play", duration(book.durationSec)]
      : started
        ? ["Continue", left]
        : ["Play", duration(book.durationSec)];

  const coverSrc = book.coverHash ? apiPaths.coverUrl(book.id, book.coverHash, 600) : null;

  return (
    <>
      <div
        className="hero"
        style={
          {
            "--tint": book.coverColor ?? FALLBACK_TINT.page,
            "--art": coverSrc ? `url("${coverSrc}")` : "none",
          } as React.CSSProperties
        }
      >
        <HeroBar onMore={() => setMenu(true)} />
        <div className="book-hero">
          <Cover
            src={coverSrc}
            color={book.coverColor}
            title={book.title}
            subtitle={book.author}
            large
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            {book.series ? (
              <div className="book-series">
                <Link href={`/?series=${encodeURIComponent(book.series)}`}>{book.series}</Link>
                {book.seriesPosition !== null ? <span className="muted">Book {book.seriesPosition}</span> : null}
              </div>
            ) : null}
            <h1 className="book-title">{book.title}</h1>
            <div className="book-by">
              {book.author ? (
                <Link className="book-author" href={`/?author=${encodeURIComponent(book.author)}`}>
                  {book.author}
                </Link>
              ) : (
                "Unknown author"
              )}
            </div>
            {book.narrator ? <div className="book-narrator">Narrated by {book.narrator}</div> : null}
            <div className="book-meta">
              <span>{duration(book.durationSec)}</span>
              {book.year ? <span>{book.year}</span> : null}
              {book.chapters.length > 1 ? <span>{plural(book.chapters.length, "chapter")}</span> : null}
              {book.missingSince ? <span className="error">Files missing</span> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="actions">
        <button
          type="button"
          className="btn btn-primary btn-big"
          aria-label={`${playLabel}, ${playSub}`}
          onClick={onPlay}
          data-loading={loading || undefined}
        >
          {current && playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
          <span>{playSub}</span>
        </button>
        {canPlayNext ? (
          <button
            type="button"
            className="btn-round"
            aria-label={onPlayNext ? "Remove from Play next" : "Add to Play next"}
            aria-pressed={onPlayNext}
            onClick={togglePlayNext}
          >
            <QueueAddIcon queued={onPlayNext} />
          </button>
        ) : null}
        <button
          type="button"
          className="btn-round"
          aria-label={finished ? "Mark as not finished" : "Mark as finished"}
          aria-pressed={finished}
          onClick={() => void markFinished(!finished)}
        >
          <CheckIcon />
        </button>
      </div>
      {started || current ? (
        <div className="bar thick" style={{ marginTop: 12 }}>
          <div style={{ width: `${pct}%` }} />
        </div>
      ) : null}

      {book.description ? (
        <Description text={book.description} longerThan={280} />
      ) : null}

      {bookmarks.length ? (
        <section className="section">
          <div className="section-head">
            <SectionTitle title="Bookmarks" count={bookmarks.length} noun="bookmark" />
          </div>
          <BookmarkRows bookmarks={bookmarks} onJump={(b) => void player.jumpTo({ itemType: "book", itemId: book.id }, b.positionSec)} />
        </section>
      ) : null}

      {book.chapters.length > 1 ? (
        <section className="section">
          <div className="section-head">
            <SectionTitle title="Chapters" count={book.chapters.length} noun="chapter" />
          </div>
          <ChapterList chapters={book.chapters} current={currentChapter} onPick={playChapter} />
        </section>
      ) : null}

      <MenuSheet
        open={menu}
        onClose={() => setMenu(false)}
        title={book.title}
        items={(choose) => <BookMenuItems book={book} edit={(_, tab) => setEditing(tab)} choose={choose} />}
      />

      {isAdmin && editing ? (
        <EditBookDialog
          key={editing}
          bookId={book.id}
          open
          tab={editing}
          onClose={() => setEditing(null)}
          onChanged={() => router.refresh()}
        />
      ) : null}
    </>
  );
}
