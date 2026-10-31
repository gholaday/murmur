"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";
import { apiPaths, type BookDetail, type BookmarkDto, bookStarted, type ChapterDto, chapterAt, duration, errorText, pastStart, plural, timeLeft } from "@murmur/shared/client";
import { BookmarkRows } from "../bookmark-rows";
import { useBookmarks } from "../bookmarks";
import { MenuSheet } from "../card-menu";
import { Cover } from "../cover";
import { CheckIcon, MoreIcon, PauseIcon, PlayIcon, QueueAddIcon } from "../icons";
import { bookToPlayable, usePlayer, usePosition } from "../player/engine";
import { setFinished } from "../progress";
import { BookMenuItems } from "../library/book-card";
import { BackButton, SectionTitle } from "../ui";
import { EditBookDialog, type EditTab } from "./edit-dialog";
import { setPlayNext } from "./play-next";

export function BookView({ book, bookmarks: firstBookmarks, isAdmin }: { book: BookDetail; bookmarks: BookmarkDto[]; isAdmin: boolean }) {
  const router = useRouter();
  const player = usePlayer();
  const bookmarks = useBookmarks("book", book.id, firstBookmarks);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState<EditTab | null>(null);
  const [expanded, setExpanded] = useState(false);

  const current = player.isCurrent("book", book.id);
  // Only follow the playhead while this book is the one playing.
  const livePosition = usePosition(current);
  const finished = !!book.progress?.finished && !current;
  const position = current ? livePosition : book.progress && !book.progress.finished ? book.progress.positionSec : 0;
  const started = pastStart(position);
  const pct = book.durationSec ? Math.min(100, (position / book.durationSec) * 100) : 0;
  const currentChapter = started || current ? chapterAt(book.chapters, position) : -1;
  const onPlayNext = book.playNext !== null;
  // A started book is in Continue listening, so it can't go on Play next.
  const canPlayNext = !current && !bookStarted(book);
  const playable = () => bookToPlayable(book);
  const { play } = player;
  const playChapter = useCallback((startSec: number) => play(bookToPlayable(book), startSec), [play, book]);

  // Starting the book opens the full player; pausing and resuming leave it as it is.
  const onPlay = () => {
    if (current) return player.toggle();
    player.play(playable(), finished ? 0 : undefined);
    player.setExpanded(true);
  };

  const mark = async (done: boolean) => {
    setMenu(false);
    // The player saves the one it has loaded; the refresh below waits for either save.
    if (current) await player.markCurrent(done);
    else await setFinished("book", book.id, book.durationSec, done);
    toast(done ? "Marked as finished" : "Marked as not finished");
    router.refresh();
  };

  const togglePlayNext = () => {
    setMenu(false);
    void setPlayNext(book.id, !onPlayNext, () => router.refresh()).catch((err: unknown) => toast.error(errorText(err)));
  };

  const left = timeLeft(book.durationSec, position);
  const [playLabel, playSub] = current
    ? [player.playing ? "Pause" : "Resume", left]
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
            "--tint": book.coverColor ?? "#2a3550",
            "--art": coverSrc ? `url("${coverSrc}")` : "none",
          } as React.CSSProperties
        }
      >
        <div className="hero-bar">
          <BackButton />
          <button type="button" className="icon-btn" aria-label="More options" onClick={() => setMenu(true)}>
            <MoreIcon />
          </button>
        </div>
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
          data-loading={(current && player.loading) || undefined}
        >
          {current && player.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
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
          onClick={() => void mark(!finished)}
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
        <>
          <p className={`description ${expanded ? "" : "clamped"}`}>{book.description}</p>
          {book.description.length > 280 ? (
            <button type="button" className="more-link" onClick={() => setExpanded((e) => !e)}>
              {expanded ? "Less" : "More"}
            </button>
          ) : null}
        </>
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
        <ChapterList chapters={book.chapters} currentChapter={currentChapter} onPlay={playChapter} />
      ) : null}

      <MenuSheet
        open={menu}
        onClose={() => setMenu(false)}
        title={book.title}
        items={(choose) => <BookMenuItems book={book} isAdmin={isAdmin} edit={(_, tab) => setEditing(tab)} choose={choose} />}
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

/**
 * Memoized so a long book's chapter list redraws when the chapter changes, not on every
 * playhead tick while the rest of the page follows the time.
 */
const ChapterList = memo(function ChapterList({
  chapters,
  currentChapter,
  onPlay,
}: {
  chapters: ChapterDto[];
  currentChapter: number;
  onPlay: (startSec: number) => void;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <SectionTitle title="Chapters" count={chapters.length} noun="chapter" />
      </div>
      <ol className="chapter-list">
        {chapters.map((c, i) => (
          <li key={c.index} className={i < currentChapter ? "done" : ""}>
            <button type="button" aria-current={i === currentChapter || undefined} onClick={() => onPlay(c.startSec)}>
              <span className="chapter-num">{i + 1}</span>
              <span className="chapter-title">{c.title}</span>
              <span className="muted small">{duration(c.endSec - c.startSec)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
});
