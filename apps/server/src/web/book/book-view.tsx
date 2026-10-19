"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPaths, type BookDetail } from "@murmur/shared";
import { api } from "../api";
import { Cover } from "../cover";
import { duration, plural, timeLeft } from "../format";
import { BackIcon, CheckIcon, MoreIcon, PauseIcon, PlayIcon, QueueIcon } from "../icons";
import { bookToPlayable, chapterAt, usePlayer, usePosition } from "../player/engine";
import { setFinished } from "../progress";
import { Sheet, SheetItem } from "../sheet";
import { MatchDialog } from "./match-dialog";

export function BookView({ book, isAdmin }: { book: BookDetail; isAdmin: boolean }) {
  const router = useRouter();
  const player = usePlayer();
  const livePosition = usePosition();
  const [menu, setMenu] = useState(false);
  const [matching, setMatching] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const current = player.isCurrent("book", book.id);
  const finished = !!book.progress?.finished && !current;
  const position = current ? livePosition : book.progress && !book.progress.finished ? book.progress.positionSec : 0;
  const started = position > 5;
  const pct = book.durationSec ? Math.min(100, (position / book.durationSec) * 100) : 0;
  const currentChapter = started || current ? chapterAt(book.chapters, position) : -1;
  const queued = player.queue.some((q) => q.itemType === "book" && q.itemId === book.id);
  const playable = () => bookToPlayable(book);

  const onPlay = () => {
    if (current) return player.toggle();
    player.play(playable(), finished ? 0 : undefined);
  };

  const mark = async (done: boolean) => {
    setMenu(false);
    if (current) player.markCurrent(done);
    else await setFinished("book", book.id, book.durationSec, done);
    router.refresh();
  };

  const queue = async (at: "next" | "last") => {
    setMenu(false);
    await player.queueAdd({ itemType: "book", itemId: book.id }, at);
    setNotice(at === "next" ? "Plays next." : "Added to Up Next.");
  };

  const revertMatch = async () => {
    setMenu(false);
    await api(`/api/books/${book.id}/match`, { method: "DELETE" });
    router.refresh();
  };

  const left = timeLeft(book.durationSec, position);
  const [playLabel, playSub] = current
    ? [player.playing ? "Pause" : "Resume", left]
    : finished
      ? ["Listen again", duration(book.durationSec)]
      : started
        ? ["Continue", left]
        : ["Play", duration(book.durationSec)];

  return (
    <>
      <div className="hero" style={{ "--tint": book.coverColor ?? "#2a3550" } as React.CSSProperties}>
        <div className="hero-bar">
          <button
            type="button"
            className="icon-btn"
            aria-label="Back"
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          >
            <BackIcon />
          </button>
          <button type="button" className="icon-btn" aria-label="More options" onClick={() => setMenu(true)}>
            <MoreIcon />
          </button>
        </div>
        <div className="book-hero">
          <Cover
            src={book.coverHash ? apiPaths.coverUrl(book.id, book.coverHash, 600) : null}
            color={book.coverColor}
            title={book.title}
            subtitle={book.author}
            large
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            {book.series ? (
              <Link href={`/?series=${encodeURIComponent(book.series)}`} className="book-series">
                {book.series}
                {book.seriesPosition !== null ? ` · Book ${book.seriesPosition}` : ""}
              </Link>
            ) : null}
            <h1 className="book-title">{book.title}</h1>
            <div className="book-by">
              {book.author ? <Link href={`/?author=${encodeURIComponent(book.author)}`}>{book.author}</Link> : "Unknown author"}
              {book.narrator ? ` · Narrated by ${book.narrator}` : ""}
            </div>
            <div className="book-meta">
              {[duration(book.durationSec), book.year, book.chapters.length > 1 ? plural(book.chapters.length, "chapter") : null]
                .filter(Boolean)
                .join(" · ")}
              {book.missingSince ? " · Files missing" : ""}
            </div>
          </div>
        </div>
      </div>

      <div className="actions">
        <button type="button" className="btn btn-primary btn-big" onClick={onPlay} data-loading={(current && player.loading) || undefined}>
          {current && player.playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
          <span className="btn-stack">
            <span>{playLabel}</span>
            <span className="btn-stack-sub">{playSub}</span>
          </span>
        </button>
        <button
          type="button"
          className="btn-round"
          aria-label={queued ? "In Up Next" : "Add to Up Next"}
          aria-pressed={queued}
          onClick={() => void queue("last")}
          disabled={current}
        >
          <QueueIcon />
        </button>
        <button
          type="button"
          className="btn-round"
          aria-label={book.progress?.finished ? "Mark as not finished" : "Mark as finished"}
          aria-pressed={!!book.progress?.finished}
          onClick={() => void mark(!book.progress?.finished)}
        >
          <CheckIcon />
        </button>
      </div>
      {notice ? (
        <p className="muted small" role="status">
          {notice}
        </p>
      ) : null}
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
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Chapters</h2>
            <span className="muted small">{book.chapters.length}</span>
          </div>
          <ol className="chapter-list">
            {book.chapters.map((c, i) => (
              <li key={c.index} className={i < currentChapter ? "done" : ""}>
                <button
                  type="button"
                  aria-current={i === currentChapter || undefined}
                  onClick={() => player.play(playable(), c.startSec)}
                >
                  <span className="chapter-num">{i + 1}</span>
                  <span className="chapter-title">{c.title}</span>
                  <span className="muted small">{duration(c.endSec - c.startSec)}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <Sheet open={menu} onClose={() => setMenu(false)} title={book.title}>
        <SheetItem onClick={() => void queue("next")} disabled={current}>
          Play next
        </SheetItem>
        <SheetItem onClick={() => void queue("last")} disabled={current}>
          Add to end of Up Next
        </SheetItem>
        <SheetItem onClick={() => void mark(!book.progress?.finished)}>
          {book.progress?.finished ? "Mark as not finished" : "Mark as finished"}
        </SheetItem>
        {book.progress && !book.progress.finished ? (
          <SheetItem onClick={() => void mark(false)}>Reset progress</SheetItem>
        ) : null}
        {isAdmin ? (
          <SheetItem
            onClick={() => {
              setMenu(false);
              setMatching(true);
            }}
          >
            Match metadata…
          </SheetItem>
        ) : null}
        {isAdmin && book.match ? (
          <SheetItem danger onClick={() => void revertMatch()}>
            Undo match (use file metadata)
          </SheetItem>
        ) : null}
      </Sheet>

      {isAdmin ? (
        <MatchDialog
          book={book}
          open={matching}
          onClose={() => setMatching(false)}
          onApplied={() => {
            setMatching(false);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
