"use client";

import { toast } from "sonner";
import { useState } from "react";
import { apiPaths, duration, plural, type QueueEntry, type QueueRef, timeLeft } from "@murmur/shared/client";
import { Cover } from "./cover";
import { CloseIcon, DragIcon, PlayIcon } from "./icons";
import { chapterAt, type Playable, usePlayer, usePosition } from "./player/engine";
import { QueueRowsSkeleton } from "./skeletons";
import { useSortable } from "./sortable";

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

/** Its own component so the playhead ticks redraw this card, not the whole queue below it. */
function NowPlayingCard({ item, onOpen }: { item: Playable; onOpen: () => void }) {
  const position = usePosition();
  const nowChapter = item.chapters[chapterAt(item.chapters, position)];
  return (
    <section className="section" style={{ marginTop: 0 }}>
      <div className="eyebrow">Now playing</div>
      <button
        type="button"
        className="now-card"
        style={{ "--tint": item.color ?? undefined } as React.CSSProperties}
        onClick={onOpen}
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
  );
}

export function UpNextView() {
  const player = usePlayer();
  const { item } = player;
  // Shown right away while the server saves, so a dropped row doesn't jump back first.
  const [pending, setPending] = useState<QueueEntry[] | null>(null);
  const queue = pending ?? player.queue;

  const save = (entries: QueueEntry[]) => {
    setPending(entries);
    player
      .queueReplace(entries.map(toRef))
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Couldn't save the queue.");
        void player.refreshQueue();
      })
      .finally(() => setPending(null));
  };

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= queue.length) return;
    const next = [...queue];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    save(next);
  };

  const sortable = useSortable(move);

  const total = queue.reduce((sum, e) => sum + entryView(e).remaining, 0);

  return (
    <>
      <div className="page-head" style={{ alignItems: "flex-end" }}>
        <div>
          <h1 className="page-title">
            Up Next
            {queue.length ? (
              <span className="count-pill" aria-label={plural(queue.length, "item")}>
                {queue.length}
              </span>
            ) : null}
          </h1>
          {!player.queueLoaded ? (
            <div className="skel skel-line" style={{ width: 110, height: 11, marginTop: 6 }} />
          ) : queue.length ? (
            <div className="page-sub">{duration(total)} to listen</div>
          ) : null}
        </div>
        {queue.length ? (
          <button type="button" className="btn" style={{ background: "none", color: "var(--accent)" }} onClick={() => {
              const previous = queue;
              save([]);
              toast("Up Next cleared", { action: { label: "Undo", onClick: () => save(previous) } });
            }}>
            Clear
          </button>
        ) : null}
      </div>

      {item ? <NowPlayingCard item={item} onOpen={() => player.setExpanded(true)} /> : null}

      <section className="section">
        {queue.length || !player.queueLoaded ? <div className="eyebrow">Next</div> : null}
        {!player.queueLoaded ? (
          <QueueRowsSkeleton />
        ) : queue.length === 0 ? (
          <div className="empty">
            <strong>Your queue is empty</strong>
          </div>
        ) : (
          <div ref={sortable.listRef} className={`list ${sortable.sorting ? "sorting" : ""}`}>
            {queue.map((e, i) => {
              const v = entryView(e);
              const row = sortable.rowProps(i);
              return (
                <div key={`${e.itemType}:${e.itemId}`} data-row className={`queue-row ${row.className}`} style={row.style}>
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
                    {...sortable.handleProps(i)}
                  >
                    <DragIcon />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
