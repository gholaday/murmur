"use client";

import { toast } from "sonner";
import { useEffect, useRef } from "react";
import { chapterAt, queueEntryView, timeLeft, type UpNextEntry } from "@murmur/shared/client";
import { Cover } from "./cover";
import { CloseIcon } from "./icons";
import { Marquee } from "./marquee";
import { Mixer } from "./mixer";
import { type Playable, usePlayerControls, usePlayerSelect, usePosition } from "./player/engine";
import { Sheet } from "./sheet";
import { QueueRowsSkeleton } from "./skeletons";
import { DragHandle, useSortable } from "./sortable";
import { EmptyState } from "./ui";

/**
 * A book playing isn't in Up Next, so it sits on its own above the list. Its own component so the
 * playhead ticks redraw this row, not the whole list below it.
 */
function BookRow({ item }: { item: Playable }) {
  const position = usePosition();
  const playing = usePlayerSelect((p) => p.playing);
  const { toggle } = usePlayerControls();
  const where = item.chapters[chapterAt(item.chapters, position)]?.title ?? item.subtitle;
  return (
    <section>
      <div className="eyebrow">Now playing</div>
      {/* Tapping it pauses and resumes. */}
      <button type="button" className="queue-row playing now-row" onClick={toggle} aria-label={`${playing ? "Pause" : "Play"} ${item.title}`}>
        <span className="thumb-wrap">
          <Cover className="thumb" src={item.coverPath} color={item.color} title={item.title} />
          <Mixer playing={playing} thumb resume />
        </span>
        <span className="list-row-main">
          <span className="list-row-title" style={{ fontSize: 14 }}>
            {item.title}
          </span>
          {where ? <span className="list-row-sub">{where}</span> : null}
          {item.durationSec ? <span className="list-row-sub">{timeLeft(item.durationSec, position)}</span> : null}
        </span>
      </button>
    </section>
  );
}

/**
 * Up Next as one running list, like YouTube Music's: what played stays above the item playing and
 * what's next follows it. Any row plays when tapped (the playing one pauses), and moves or comes out.
 */
export function UpNextSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { waiting, from, clear } = useQueueHead();

  // Opens on the item playing, with a little of what played above it.
  const playingRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) playingRow.current?.scrollIntoView({ block: "center" });
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title="Queue" count={waiting} sub={from} action={clear}>
      <UpNextList playingRowRef={playingRow} />
    </Sheet>
  );
}

/**
 * What the queue's title row shows: how many are waiting, where they came from, and Clear
 * (with an Undo) while anything waits.
 */
export function useQueueHead() {
  const player = usePlayerControls();
  const upNext = usePlayerSelect((p) => p.upNext);
  const waiting = Math.max(0, upNext.items.length - upNext.index - 1);
  const clear = () => {
    const before = upNext;
    player.clearUpNext();
    toast("Queue cleared", { action: { label: "Undo", onClick: () => player.restoreUpNext(before) } });
  };
  return {
    waiting,
    from: upNext.source ? `From ${upNext.source.title}` : null,
    clear:
      waiting > 0 ? (
        <button type="button" className="btn" style={{ background: "none", color: "var(--accent)", padding: 0, minHeight: 0 }} onClick={clear}>
          Clear
        </button>
      ) : null,
  };
}

/** The queue's rows: a book playing on its own on top, then Up Next with what played above the item playing. */
export function UpNextList({ playingRowRef }: { playingRowRef?: React.Ref<HTMLDivElement> }) {
  const player = usePlayerControls();
  const upNext = usePlayerSelect((p) => p.upNext);
  const upNextLoaded = usePlayerSelect((p) => p.upNextLoaded);
  const item = usePlayerSelect((p) => p.item);
  const { items, index } = upNext;
  const sortable = useSortable(player.moveItem);
  return (
    <>
      {item?.type === "book" ? <BookRow item={item} /> : null}
      {!upNextLoaded ? (
        <QueueRowsSkeleton />
      ) : items.length === 0 ? (
        item?.type === "book" ? null : <EmptyState title="The queue is empty" />
      ) : (
        <div ref={sortable.listRef} className={`list ${sortable.sorting ? "sorting" : ""}`}>
          {items.map((e, i) => (
            <UpNextRow
              key={`${e.itemType}:${e.itemId}:${i}`}
              entry={e}
              index={i}
              state={i < index ? "played" : i === index ? "playing" : "next"}
              rowRef={i === index ? playingRowRef : undefined}
              sortable={sortable}
            />
          ))}
        </div>
      )}
    </>
  );
}

function UpNextRow({
  entry,
  index,
  state,
  rowRef,
  sortable,
}: {
  entry: UpNextEntry;
  index: number;
  state: "played" | "playing" | "next";
  rowRef?: React.Ref<HTMLDivElement>;
  sortable: ReturnType<typeof useSortable>;
}) {
  const player = usePlayerControls();
  const v = queueEntryView(entry);
  const row = sortable.rowProps(index);
  const playingNow = state === "playing";
  const playing = usePlayerSelect((p) => playingNow && p.playing);
  return (
    <div ref={rowRef} data-row className={`queue-row ${state === "next" ? "" : state} ${row.className}`} style={row.style}>
      <button
        type="button"
        className="list-row-play now-row"
        onClick={() => (playingNow ? player.toggle() : player.playAt(index))}
        aria-label={`${playing ? "Pause" : "Play"} ${v.title}`}
      >
        <span className="thumb-wrap">
          <Cover className="thumb" src={v.cover} color={v.color} title={v.title} />
          {playingNow ? <Mixer playing={playing} thumb resume /> : null}
        </span>
        <span className="list-row-main">
          <Marquee className="list-row-title" text={v.title} />
          <span className="list-row-sub up-next-sub">
            <span>{v.kind}</span>
            <span>{v.length}</span>
          </span>
        </span>
      </button>
      <button type="button" className="icon-btn dim" aria-label={`Remove ${v.title}`} onClick={() => player.removeAt(index)}>
        <CloseIcon size={18} />
      </button>
      <DragHandle label={v.title} {...sortable.handleProps(index)} />
    </div>
  );
}
