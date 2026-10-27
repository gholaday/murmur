"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";
import { apiPaths, type BookDetail, bookStarted, type ChapterDto, chapterAt, duration, errorText, plural, timeLeft } from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { BookmarkAddIcon, CheckIcon, MoreIcon, PauseIcon, PlayIcon } from "../icons";
import { bookToPlayable, usePlayer, usePosition } from "../player/engine";
import { setFinished } from "../progress";
import { Sheet, SheetItem } from "../sheet";
import { BackButton, SectionTitle } from "../ui";
import { EditBookDialog, type EditTab } from "./edit-dialog";
import { setMarkedMatched } from "./match-mark";
import { setPlayNext } from "./play-next";

export function BookView({ book, isAdmin }: { book: BookDetail; isAdmin: boolean }) {
  const router = useRouter();
  const player = usePlayer();
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState<EditTab | null>(null);
  const [expanded, setExpanded] = useState(false);

  const current = player.isCurrent("book", book.id);
  // Only follow the playhead while this book is the one playing.
  const livePosition = usePosition(current);
  const finished = !!book.progress?.finished && !current;
  const position = current ? livePosition : book.progress && !book.progress.finished ? book.progress.positionSec : 0;
  const started = position > 5;
  const pct = book.durationSec ? Math.min(100, (position / book.durationSec) * 100) : 0;
  const currentChapter = started || current ? chapterAt(book.chapters, position) : -1;
  const onPlayNext = book.playNext !== null;
  // A started book is in Continue listening, so it can't go on Play next.
  const canPlayNext = !current && !bookStarted(book);
  const playable = () => bookToPlayable(book);
  const { play } = player;
  const playChapter = useCallback((startSec: number) => play(bookToPlayable(book), startSec), [play, book]);

  const onPlay = () => {
    if (current) return player.toggle();
    player.play(playable(), finished ? 0 : undefined);
  };

  const mark = async (done: boolean) => {
    setMenu(false);
    if (current) player.markCurrent(done);
    // Saved here too (not only by the player) so the refresh below already sees it.
    await setFinished("book", book.id, book.durationSec, done);
    toast(done ? "Marked as finished" : "Marked as not finished");
    router.refresh();
  };

  const togglePlayNext = () => {
    setMenu(false);
    void setPlayNext(book.id, !onPlayNext, () => router.refresh()).catch((err: unknown) => toast.error(errorText(err)));
  };

  const revertMatch = async () => {
    setMenu(false);
    await api(`/api/books/${book.id}/match`, { method: "DELETE" });
    toast("Match undone, using the files' details");
    router.refresh();
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
            <BookmarkAddIcon added={onPlayNext} />
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

      {book.chapters.length > 1 ? (
        <ChapterList chapters={book.chapters} currentChapter={currentChapter} onPlay={playChapter} />
      ) : null}

      <Sheet open={menu} onClose={() => setMenu(false)} title={book.title}>
        {canPlayNext ? <SheetItem onClick={togglePlayNext}>{onPlayNext ? "Remove from Play next" : "Add to Play next"}</SheetItem> : null}
        <SheetItem onClick={() => void mark(!finished)}>
          {finished ? "Mark as not finished" : "Mark as finished"}
        </SheetItem>
        {book.progress && !book.progress.finished ? (
          <SheetItem onClick={() => void mark(false)}>Reset progress</SheetItem>
        ) : null}
        {isAdmin ? (
          <>
            <SheetItem
              onClick={() => {
                setMenu(false);
                setEditing("details");
              }}
            >
              Edit details…
            </SheetItem>
            <SheetItem
              onClick={() => {
                setMenu(false);
                setEditing("cover");
              }}
            >
              Change cover…
            </SheetItem>
            <SheetItem
              onClick={() => {
                setMenu(false);
                setEditing("match");
              }}
            >
              Match metadata…
            </SheetItem>
            {/* Not offered once a real match was applied: Undo match is the way back there. */}
            {!book.match ? (
              <SheetItem
                onClick={() => {
                  setMenu(false);
                  void setMarkedMatched(book.id, !book.markedMatched, () => router.refresh()).catch((err: unknown) => toast.error(errorText(err)));
                }}
              >
                {book.markedMatched ? "Mark as not matched" : "Mark as matched"}
              </SheetItem>
            ) : null}
          </>
        ) : null}
        {isAdmin && book.match ? (
          <SheetItem danger onClick={() => void revertMatch()}>
            Undo match (use file metadata)
          </SheetItem>
        ) : null}
      </Sheet>

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
