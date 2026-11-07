"use client";

import Link from "next/link";
import { albumCover, songLength, songSub, type TrackDto } from "@murmur/shared/client";
import { Cover } from "../cover";
import { Mixer } from "../mixer";
import { useNowPlaying } from "../player/engine";
import { DragHandle, type useSortable } from "../sortable";
import { MineToggle } from "./mine";
import { SongMenuButton } from "./song-menu";

/**
 * A song with its album's cover, title, "Artist, Album" and length. With `onPlay` the row plays it,
 * otherwise it opens the album; `toggle` adds the + / check. In a list that's dragged into order,
 * `sortable` gives the row its place and a drag handle.
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
        <span className="list-row-sub">{sub ?? songSub(track)}</span>
      </span>
    </>
  );
  const row = sortable?.list.rowProps(sortable.index);
  return (
    <div
      data-row={sortable ? true : undefined}
      className={`${sortable ? "queue-row" : "list-row"}${current ? " playing" : ""} ${row?.className ?? ""}`}
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
      <span className="muted small">{songLength(track)}</span>
      {toggle ? <MineToggle title={track.title} added={track.inMusic} change={{ trackIds: [track.id] }} /> : null}
      <SongMenuButton track={track} extra={menuExtra} />
      {sortable ? <DragHandle label={track.title} {...sortable.list.handleProps(sortable.index)} /> : null}
    </div>
  );
}
