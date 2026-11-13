"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  albumCover,
  apiPaths,
  duration,
  errorText,
  FALLBACK_TINT,
  type PlaylistDetail,
  type PlaylistSummary,
  playlistCoverTiles,
  plural,
  type SongSort,
  sortSongs,
} from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { useWide } from "../layout";
import { Mixer } from "../mixer";
import { DownIcon, MoreIcon, PauseIcon, PlayIcon, PlusIcon } from "../icons";
import { ShuffleButton } from "./shuffle-button";
import { type MusicSource, usePlayerControls, usePlayerSelect } from "../player/engine";
import { ConfirmSheet, Sheet, SheetItem } from "../sheet";
import { reorder, useSortable } from "../sortable";
import { BackRow, EmptyState } from "../ui";
import { SongRow } from "./song-row";

/** The playlist's album covers sharing one square (playlistCoverTiles), or a tile with the name when it has none. */
export function PlaylistCover({ playlist, large }: { playlist: PlaylistSummary; large?: boolean }) {
  const { covers } = playlist;
  if (covers.length < 2) {
    const first = covers[0];
    return <Cover src={first ? albumCover(first.albumId, first.coverHash, large ? 600 : 200) : null} color={null} title={playlist.name} large={large} />;
  }
  return (
    <div className="cover playlist-cover" aria-hidden="true">
      {playlistCoverTiles(covers).map(({ cover, x, y, w, h }) => (
        // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP from our own server
        <img
          key={cover.albumId}
          src={albumCover(cover.albumId, cover.coverHash, large ? 600 : 200)!}
          alt=""
          style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
        />
      ))}
    </div>
  );
}

export function PlaylistCard({ playlist }: { playlist: PlaylistSummary }) {
  const current = usePlayerSelect((s) => s.isPlayingFrom("playlist", playlist.id));
  const playing = usePlayerSelect((s) => current && s.playing);
  return (
    <div className={`card${current ? " playing" : ""}`}>
      <div className="card-cover">
        <Link href={`/music/playlist/${playlist.id}`} aria-label={playlist.name} tabIndex={-1}>
          <PlaylistCover playlist={playlist} />
        </Link>
        {current ? <Mixer playing={playing} /> : null}
      </div>
      <Link href={`/music/playlist/${playlist.id}`} className="card-link">
        <div className="card-title">{playlist.name}</div>
        <div className="card-sub">{plural(playlist.trackCount, "song")}</div>
      </Link>
    </div>
  );
}

/** The New playlist tile, first in the Playlists grid, and its sheet; opens the new playlist once it's made. */
export function NewPlaylistButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const p = await api<PlaylistDetail>(apiPaths.playlists, { method: "POST", body: { name: name.trim() } });
      router.push(`/music/playlist/${p.id}`);
    } catch (err) {
      toast.error(errorText(err, "Couldn't make that playlist."));
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="new-tile"
        onClick={() => {
          setName("");
          setOpen(true);
        }}
      >
        <span className="new-tile-art">
          <PlusIcon size={34} />
        </span>
        <span className="card-title">New playlist</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="New playlist">
        <NameForm name={name} setName={setName} busy={busy} label="Make playlist" onSubmit={() => void create()} />
      </Sheet>
    </>
  );
}

function NameForm({ name, setName, busy, label, onSubmit }: { name: string; setName: (s: string) => void; busy: boolean; label: string; onSubmit: () => void }) {
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit();
      }}
    >
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Playlist name" aria-label="Playlist name" autoFocus />
      <button type="submit" className="btn btn-primary btn-big" disabled={busy || !name.trim()}>
        {busy ? "Saving…" : label}
      </button>
    </form>
  );
}

type PlaylistSort = { col: SongSort; desc: boolean } | null;

/** A column head that sorts the playlist by it; the arrow shows on the one in use. */
function SortHead({ col, label, sort, onSort }: { col: SongSort; label: string; sort: PlaylistSort; onSort: (col: SongSort) => void }) {
  const on = sort?.col === col;
  return (
    <button
      type="button"
      className="sort-head"
      aria-pressed={on}
      aria-label={on ? `Sorted by ${label}${sort.desc ? ", reversed" : ""}` : `Sort by ${label}`}
      data-desc={on && sort.desc ? true : undefined}
      onClick={() => onSort(col)}
    >
      {label}
      {on ? <DownIcon size={14} /> : null}
    </button>
  );
}

/** One playlist: play or shuffle it, drag songs to reorder, remove them, rename or delete it. */
export function PlaylistView({ playlist: initial }: { playlist: PlaylistDetail }) {
  const router = useRouter();
  const player = usePlayerControls();
  const [playlist, setPlaylist] = useState(initial);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(initial.name);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { tracks } = playlist;
  // Wide screens can sort by a column head; phones always show the playlist's own order.
  const wide = useWide();
  const [sortBy, setSortBy] = useState<PlaylistSort>(null);
  const sort = wide ? sortBy : null;
  const shown = useMemo(() => (sort ? sortSongs(tracks, sort.col, sort.desc) : tracks), [tracks, sort]);
  // Again reverses; a third time goes back to the playlist's order.
  const sortOn = (col: SongSort) => setSortBy(sort?.col !== col ? { col, desc: false } : sort.desc ? null : { col, desc: true });
  // Plays in the order shown.
  const source: MusicSource = { kind: "playlist", refId: playlist.id, title: playlist.name, tracks: shown };
  const from = usePlayerSelect((s) => s.isPlayingFrom("playlist", playlist.id));
  const nowId = usePlayerSelect((s) => (s.item?.type === "track" ? s.item.id : null));
  const nowHere = nowId !== null && tracks.some((t) => t.id === nowId);
  // Only while this playlist's song is loaded, so other music playing doesn't re-render the list.
  const playing = usePlayerSelect((s) => (from || nowHere) && s.playing);
  // Starting the playlist opens the full player; pausing and resuming leave it as it is.
  const onPlay = () => {
    if (from) return player.toggle();
    player.playMusic(source, -1);
    player.setExpanded(true);
  };

  const save = async (change: { name?: string; trackIds?: string[] }, done?: string) => {
    setBusy(true);
    try {
      setPlaylist(await api<PlaylistDetail>(apiPaths.playlist(playlist.id), { method: "PATCH", body: change }));
      if (done) toast(done);
      return true;
    } catch (err) {
      toast.error(errorText(err, "Couldn't save the playlist."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const setOrder = (next: PlaylistDetail["tracks"]) => {
    const before = playlist;
    // Shown at once; the server's answer replaces it, and a failure puts it back.
    setPlaylist({ ...playlist, tracks: next });
    void save({ trackIds: next.map((t) => t.id) }).then((ok) => ok || setPlaylist(before));
  };

  const sortable = useSortable((from, to) => setOrder(reorder(tracks, from, to)));

  const remove = (id: string) => {
    const before = tracks;
    setOrder(tracks.filter((t) => t.id !== id));
    toast("Removed from the playlist", { action: { label: "Undo", onClick: () => setOrder(before) } });
  };

  const del = async () => {
    setBusy(true);
    try {
      await api(apiPaths.playlist(playlist.id), { method: "DELETE" });
      toast(`Deleted ${playlist.name}`);
      router.push("/music?tab=playlists");
      router.refresh();
    } catch (err) {
      toast.error(errorText(err, "Couldn't delete the playlist."));
      setBusy(false);
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="detail playlist-detail" style={{ "--tint": FALLBACK_TINT.page } as React.CSSProperties}>
        <BackRow fallback="/music">
          <button type="button" className="icon-btn" aria-label="Playlist options" onClick={() => setMenu(true)}>
            <MoreIcon />
          </button>
        </BackRow>
        {/* Wide screens (music.css): the cover, then the title, pills and buttons beside it in one row. */}
        <div className="playlist-top">
          <div className="show-hero">
            <PlaylistCover playlist={playlist} large />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 4, minWidth: 0 }}>
              <div className="eyebrow">Playlist</div>
              <h1 className="show-title">{playlist.name}</h1>
              <div className="pills">
                <span className="pill">{plural(playlist.trackCount, "song")}</span>
                {playlist.durationSec ? <span className="pill">{duration(playlist.durationSec)}</span> : null}
              </div>
            </div>
          </div>
          {tracks.length ? (
            <div className="actions">
              <button type="button" className="btn btn-primary btn-big" onClick={onPlay}>
                {from && playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
                <span>{from ? (playing ? "Pause" : "Resume") : "Play"}</span>
              </button>
              <ShuffleButton source={source} />
              <Link href={`/music/playlist/${playlist.id}/add`} className="btn-round add-songs" aria-label="Add songs">
                <PlusIcon />
                <span className="add-songs-label">Add songs</span>
              </Link>
            </div>
          ) : null}
        </div>

        {tracks.length ? (
          <section className="section">
            {/* Wide screens only: column heads that sort the list. Songs carry no date they were added on, so there's no Added column. */}
            <div className={`song-head song-row${sort ? "" : " has-handle"}`}>
              <span className="song-head-title">
                <SortHead col="title" label="Title" sort={sort} onSort={sortOn} />
              </span>
              <span className="song-album">
                <SortHead col="album" label="Album" sort={sort} onSort={sortOn} />
              </span>
              <span className="song-len">
                <SortHead col="length" label="Length" sort={sort} onSort={sortOn} />
              </span>
              <span className="song-head-end" />
            </div>
            <div ref={sortable.listRef} className={`list ${sortable.sorting ? "sorting" : ""}`}>
              {shown.map((t, i) => (
                <SongRow
                  key={t.id}
                  track={t}
                  onPlay={() => player.playMusic(source, i)}
                  // Dragging sets the playlist's own order, so it's only there while that order shows.
                  sortable={sort ? undefined : { list: sortable, index: i }}
                  menuExtra={(close) => (
                    <SheetItem
                      danger
                      onClick={() => {
                        close();
                        remove(t.id);
                      }}
                    >
                      Remove from this playlist
                    </SheetItem>
                  )}
                />
              ))}
            </div>
          </section>
        ) : (
          <EmptyState title="No songs yet" style={{ marginTop: 24 }}>
            <div className="muted small">Find songs and add them with one tap.</div>
            <Link href={`/music/playlist/${playlist.id}/add`} className="btn btn-primary btn-big" style={{ marginTop: 12 }}>
              <PlusIcon size={20} />
              <span>Add songs</span>
            </Link>
          </EmptyState>
        )}
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)} title={playlist.name}>
        {tracks.length ? (
          <SheetItem
            onClick={() => {
              setMenu(false);
              player.addToUpNext(
                tracks.map((t) => ({ itemType: "track", itemId: t.id })),
                "next",
              ).then(
                () => toast("Added to queue"),
                (err: unknown) => toast.error(errorText(err)),
              );
            }}
          >
            Add to queue
          </SheetItem>
        ) : null}
        <SheetItem
          onClick={() => {
            setMenu(false);
            setName(playlist.name);
            setRenaming(true);
          }}
        >
          Rename…
        </SheetItem>
        <SheetItem
          danger
          onClick={() => {
            setMenu(false);
            setDeleting(true);
          }}
        >
          Delete playlist
        </SheetItem>
      </Sheet>
      <ConfirmSheet
        open={deleting}
        title={`Delete ${playlist.name}?`}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() => void del()}
        onClose={() => setDeleting(false)}
      />
      <Sheet open={renaming} onClose={() => setRenaming(false)} title="Rename playlist">
        <NameForm
          name={name}
          setName={setName}
          busy={busy}
          label="Save"
          onSubmit={() => void save({ name: name.trim() }, "Renamed").then((ok) => ok && setRenaming(false))}
        />
      </Sheet>
    </>
  );
}
