"use client";

import Link from "next/link";
import { toast } from "sonner";
import { albumCover, errorText, songLength, songSub, type TrackDto } from "@murmur/shared/client";
import { Cover } from "../cover";
import { QueueAddIcon } from "../icons";
import { Mixer } from "../mixer";
import { useNowPlaying, usePlayerControls, usePlayerSelect } from "../player/engine";
import { DragHandle, type useSortable } from "../sortable";
import { MineToggle } from "./mine";
import { SongMenuButton } from "./song-menu";

/**
 * A song with its album's cover, title, "Artist, Album" and length. With `onPlay` the row plays it,
 * otherwise it opens the album; `toggle` adds the + / check. In a list that's dragged into order,
 * `sortable` gives the row its place and a drag handle. Wide screens (music.css) split the album
 * into its own column when the row has room, and show the add to queue button.
 */
export function SongRow({
  track,
  sub,
  toggle,
  onPlay,
  menuExtra,
  sortable,
}: {
  track: TrackDto;
  sub?: string;
  toggle?: boolean;
  onPlay?: () => void;
  /** More items for the song's ⋯ menu, such as removing it from a playlist. */
  menuExtra?: (close: () => void) => React.ReactNode;
  sortable?: { list: ReturnType<typeof useSortable>; index: number };
}) {
  const { current, playing } = useNowPlaying((n) => n.type === "track" && n.id === track.id);
  const body = (
    <>
      <span className="thumb-wrap">
        <Cover src={albumCover(track.albumId, track.coverHash)} color={null} title={track.album} className="thumb" />
        {current ? <Mixer playing={playing} thumb /> : null}
      </span>
      <span className="list-row-main">
        <span className="list-row-title">{track.title}</span>
        <span className="list-row-sub song-sub">{sub ?? songSub(track)}</span>
        <span className="list-row-sub song-artist">{track.artist}</span>
      </span>
    </>
  );
  const row = sortable?.list.rowProps(sortable.index);
  return (
    <div
      data-row={sortable ? true : undefined}
      className={`${sortable ? "queue-row" : "list-row"} song-row${current ? " playing" : ""} ${row?.className ?? ""}`}
      style={row?.style}
    >
      {onPlay ? (
        <button type="button" className="list-row-play" onClick={onPlay}>
          {body}
        </button>
      ) : (
        <Link href={`/music/album/${track.albumId}`} className="list-row-link">
          {body}
        </Link>
      )}
      <Link href={`/music/album/${track.albumId}`} className="song-album" tabIndex={-1}>
        {track.album}
      </Link>
      <span className="muted small song-len">{songLength(track)}</span>
      {toggle ? <MineToggle title={track.title} added={track.inMusic} change={{ trackIds: [track.id] }} /> : null}
      <SongQueueButton track={track} current={current} />
      <SongMenuButton track={track} extra={menuExtra} />
      {sortable ? <DragHandle label={track.title} {...sortable.list.handleProps(sortable.index)} /> : null}
    </div>
  );
}

/** Adds a song to the queue, or takes it out again. Wide screens only (music.css); phones use the ⋯ menu. */
export function SongQueueButton({ track, current }: { track: TrackDto; current: boolean }) {
  const player = usePlayerControls();
  const ref = { itemType: "track", itemId: track.id } as const;
  const queued = usePlayerSelect((s) => s.isWaiting(ref));
  const run = (fn: () => Promise<void>, done: string) =>
    fn().then(
      () => toast(done),
      (err: unknown) => toast.error(errorText(err, "Couldn't do that.")),
    );
  return (
    <button
      type="button"
      className="icon-btn dim song-queue"
      aria-label={queued ? `Remove ${track.title} from queue` : `Add ${track.title} to queue`}
      aria-pressed={queued}
      disabled={current}
      onClick={() => void (queued ? run(async () => player.removeWaiting(ref), "Removed from queue") : run(() => player.addToUpNext(ref, "next"), "Added to queue"))}
    >
      <QueueAddIcon size={20} queued={queued} />
    </button>
  );
}
