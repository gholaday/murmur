"use client";

import { toast } from "sonner";
import { useState } from "react";
import { albumCover, chapterAt, duration, plural, type QueueEntry, queueEntryView, queueRef, timeLeft } from "@murmur/shared/client";
import { Cover } from "./cover";
import { CloseIcon, DownIcon, DragIcon, PlayIcon } from "./icons";
import { SongRow } from "./music/music-view";
import { type Playable, usePlayer, usePosition } from "./player/engine";
import { QueueRowsSkeleton } from "./skeletons";
import { useSortable } from "./sortable";

/** Its own component so the playhead ticks redraw this card, not the whole queue below it. */
function NowPlayingCard({ item, onOpen }: { item: Playable; onOpen: () => void }) {
  const position = usePosition();
  const where = item.chapters[chapterAt(item.chapters, position)]?.title ?? item.subtitle;
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
          {where ? <span className="list-row-sub">{where}</span> : null}
          {item.durationSec ? <span className="list-row-sub">{timeLeft(item.durationSec, position)}</span> : null}
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
      .queueReplace(entries.map(queueRef))
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

  const total = queue.reduce((sum, e) => sum + queueEntryView(e).remaining, 0);

  return (
    <>
      <div className="page-head" style={{ alignItems: "flex-end" }}>
        <div>
          <h1 className="page-title">
            Listening
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
      <RestOfMusic />

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
              const v = queueEntryView(e);
              const row = sortable.rowProps(i);
              return (
                <div key={`${e.itemType}:${e.itemId}`} data-row className={`queue-row ${row.className}`} style={row.style}>
                  <Cover className="thumb" src={v.cover} color={v.color} title={v.title} />
                  <button type="button" className="list-row-main" style={{ textAlign: "left" }} onClick={() => void player.playRef(queueRef(e))}>
                    <span className="list-row-meta">{v.kind}</span>
                    <span className="list-row-title" style={{ fontSize: 14 }}>
                      {v.title}
                    </span>
                    <span className="list-row-sub">{v.length}</span>
                  </button>
                  <button type="button" className="icon-btn dim" aria-label={`Play ${v.title} now`} onClick={() => void player.playRef(queueRef(e))}>
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

/** The rest of the album or list music is playing from, as one row that opens to show the songs. */
function RestOfMusic() {
  const player = usePlayer();
  const [open, setOpen] = useState(false);
  const c = player.musicContext;
  if (!c || player.item?.type !== "track") return null;
  const rest = c.tracks.slice(c.index + 1);
  if (!rest.length) return null;
  const first = rest[0]!;
  return (
    <section className="section">
      <div className="eyebrow">Playing from</div>
      <button type="button" className="list-row context-row" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Cover className="thumb" src={albumCover(first.albumId, first.coverHash)} color={null} title={c.title} />
        <span className="list-row-main" style={{ textAlign: "left" }}>
          <span className="list-row-title">Rest of {c.title}</span>
          <span className="list-row-sub">{plural(rest.length, "song")}</span>
        </span>
        <DownIcon className="context-chevron" />
      </button>
      {open ? (
        <div className="list">
          {rest.map((t, i) => (
            <SongRow key={t.id} track={t} onPlay={() => player.playContextAt(c.index + 1 + i)} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
