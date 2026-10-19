"use client";

import { useRef, useState } from "react";
import { apiPaths, type QueueEntry, type QueueRef } from "@murmur/shared";
import { Cover } from "./cover";
import { duration, plural, timeLeft } from "./format";
import { CloseIcon, DragIcon, PlayIcon } from "./icons";
import { chapterAt, usePlayer, usePosition } from "./player/engine";

function entryView(e: QueueEntry) {
  if (e.itemType === "book") {
    const b = e.book;
    const pos = b.progress && !b.progress.finished ? b.progress.positionSec : 0;
    return {
      kind: "Audiobook",
      title: b.title,
      sub: [b.author, pos > 5 ? timeLeft(b.durationSec, pos) : duration(b.durationSec)].filter(Boolean).join(" · "),
      cover: b.coverHash ? apiPaths.coverUrl(b.id, b.coverHash, 200) : null,
      color: b.coverColor,
      remaining: Math.max(0, b.durationSec - pos),
    };
  }
  const ep = e.episode;
  const dur = ep.durationSec ?? 0;
  const pos = ep.progress && !ep.progress.finished ? ep.progress.positionSec : 0;
  return {
    kind: ep.podcastTitle,
    title: ep.title,
    sub: pos > 5 && dur ? timeLeft(dur, pos) : duration(dur),
    cover: ep.podcastCoverHash ? apiPaths.podcastCoverUrl(ep.podcastId, ep.podcastCoverHash, 200) : null,
    color: ep.podcastCoverColor,
    remaining: Math.max(0, dur - pos),
  };
}

const toRef = (e: QueueEntry): QueueRef => ({ itemType: e.itemType, itemId: e.itemId });

export function UpNextView() {
  const player = usePlayer();
  const position = usePosition();
  const { item, queue } = player;
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const save = (entries: QueueEntry[]) => {
    setError(null);
    player.queueReplace(entries.map(toRef)).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Couldn't save the queue.");
      void player.refreshQueue();
    });
  };

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= queue.length) return;
    const next = [...queue];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    save(next);
  };

  /** Row index under the pointer, for drag-to-reorder with mouse or touch. */
  const rowAt = (clientY: number): number => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
    const i = rows.findIndex((r) => {
      const box = r.getBoundingClientRect();
      return clientY < box.top + box.height / 2;
    });
    return i === -1 ? rows.length - 1 : i;
  };

  const total = queue.reduce((sum, e) => sum + entryView(e).remaining, 0);
  const nowChapter = item ? item.chapters[chapterAt(item.chapters, position)] : undefined;

  return (
    <>
      <div className="page-head" style={{ alignItems: "flex-end" }}>
        <div>
          <h1 className="page-title">Up Next</h1>
          <div className="page-sub">
            {queue.length ? `${plural(queue.length, "item")} in queue · ${duration(total)} total` : "Nothing queued"}
          </div>
        </div>
        {queue.length ? (
          <button type="button" className="btn" style={{ background: "none", color: "var(--accent)" }} onClick={() => save([])}>
            Clear
          </button>
        ) : null}
      </div>

      {item ? (
        <section className="section" style={{ marginTop: 0 }}>
          <div className="eyebrow">Now playing</div>
          <button
            type="button"
            className="now-card"
            style={{ "--tint": item.color ?? undefined } as React.CSSProperties}
            onClick={() => player.setExpanded(true)}
          >
            <Cover src={item.coverUrl} color={item.color} title={item.title} />
            <span className="list-row-main">
              <span className="list-row-title">{item.title}</span>
              <span className="list-row-sub">
                {[nowChapter?.title ?? item.subtitle, item.durationSec ? timeLeft(item.durationSec, position) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="bar" style={{ marginTop: 4 }}>
                <span
                  style={{
                    display: "block",
                    height: "100%",
                    background: "var(--accent)",
                    width: `${item.durationSec ? Math.min(100, (position / item.durationSec) * 100) : 0}%`,
                  }}
                />
              </span>
            </span>
          </button>
        </section>
      ) : null}

      <section className="section">
        {queue.length ? <div className="eyebrow">Next</div> : null}
        {error ? <p className="error small">{error}</p> : null}
        {queue.length === 0 ? (
          <div className="empty">
            <strong>Your queue is empty</strong>
            Add books and episodes with “Play next” or “Add to Up Next”. When something finishes, the next item starts on its own.
          </div>
        ) : (
          <div ref={listRef} className="list">
            {queue.map((e, i) => {
              const v = entryView(e);
              const dragging = drag?.from === i;
              const dropBefore = drag && drag.over === i && drag.from !== i && drag.from > i;
              const dropAfter = drag && drag.over === i && drag.from !== i && drag.from < i;
              return (
                <div
                  key={`${e.itemType}:${e.itemId}`}
                  data-row
                  className={`queue-row ${dragging ? "dragging" : ""} ${dropBefore ? "drop-before" : ""}`}
                  style={dropAfter ? { boxShadow: "inset 0 -2px 0 var(--accent)" } : undefined}
                >
                  <Cover className="thumb" src={v.cover} color={v.color} title={v.title} />
                  <button type="button" className="list-row-main" style={{ textAlign: "left" }} onClick={() => void player.playRef(toRef(e))}>
                    <span className="list-row-meta">{v.kind}</span>
                    <span className="list-row-title" style={{ fontSize: 14 }}>
                      {v.title}
                    </span>
                    <span className="list-row-sub">{v.sub}</span>
                  </button>
                  <button type="button" className="icon-btn dim" aria-label={`Play ${v.title} now`} onClick={() => void player.playRef(toRef(e))}>
                    <PlayIcon size={18} />
                  </button>
                  <button type="button" className="icon-btn dim" aria-label={`Remove ${v.title}`} onClick={() => save(queue.filter((_, j) => j !== i))}>
                    <CloseIcon size={18} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn drag-handle"
                    aria-label={`Reorder ${v.title}. Use arrow keys to move.`}
                    onKeyDown={(ev) => {
                      if (ev.key === "ArrowUp") {
                        ev.preventDefault();
                        move(i, i - 1);
                      } else if (ev.key === "ArrowDown") {
                        ev.preventDefault();
                        move(i, i + 1);
                      }
                    }}
                    onPointerDown={(ev) => {
                      ev.currentTarget.setPointerCapture(ev.pointerId);
                      setDrag({ from: i, over: i });
                    }}
                    onPointerMove={(ev) => {
                      if (drag) setDrag({ from: drag.from, over: rowAt(ev.clientY) });
                    }}
                    onPointerUp={() => {
                      if (drag) move(drag.from, drag.over);
                      setDrag(null);
                    }}
                    onPointerCancel={() => setDrag(null)}
                  >
                    <DragIcon />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {queue.length > 1 ? <p className="muted small" style={{ textAlign: "center" }}>Drag the handle to reorder</p> : null}
      </section>
    </>
  );
}
