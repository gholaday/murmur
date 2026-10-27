"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  albumCover,
  apiPaths,
  duration,
  errorText,
  type PlaylistDetail,
  type PlaylistSummary,
  plural,
  songLength,
  songSub,
} from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { DragIcon, MoreIcon, PlayIcon, PlusIcon, ShuffleIcon } from "../icons";
import { type MusicSource, usePlayer } from "../player/engine";
import { Sheet, SheetItem } from "../sheet";
import { useSortable } from "../sortable";
import { BackRow } from "./album-view";
import { SongMenuButton } from "./song-menu";

/** Four album covers in a square, or the first one when there are fewer, or a tile with the name. */
export function PlaylistCover({ playlist, large }: { playlist: PlaylistSummary; large?: boolean }) {
  const { covers } = playlist;
  if (covers.length < 4) {
    const first = covers[0];
    return <Cover src={first ? albumCover(first.albumId, first.coverHash, large ? 600 : 200) : null} color={null} title={playlist.name} large={large} />;
  }
  return (
    <div className="cover playlist-cover" aria-hidden="true">
      {covers.map((c) => (
        // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP from our own server
        <img key={c.albumId} src={albumCover(c.albumId, c.coverHash, large ? 600 : 200)!} alt="" />
      ))}
    </div>
  );
}

export function PlaylistCard({ playlist }: { playlist: PlaylistSummary }) {
  return (
    <div className="card">
      <div className="card-cover">
        <Link href={`/music/playlist/${playlist.id}`} aria-label={playlist.name} tabIndex={-1}>
          <PlaylistCover playlist={playlist} />
        </Link>
      </div>
      <Link href={`/music/playlist/${playlist.id}`} className="card-link">
        <div className="card-title">{playlist.name}</div>
        <div className="card-sub">{plural(playlist.trackCount, "song")}</div>
      </Link>
    </div>
  );
}

/** The New playlist button and its sheet; opens the new playlist once it's made. */
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
      toast.error(errorText(err));
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="btn btn-outline add-all"
        onClick={() => {
          setName("");
          setOpen(true);
        }}
      >
        <PlusIcon size={18} />
        New playlist
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
        {label}
      </button>
    </form>
  );
}

/** One playlist: play or shuffle it, drag songs to reorder, remove them, rename or delete it. */
export function PlaylistView({ playlist: initial }: { playlist: PlaylistDetail }) {
  const router = useRouter();
  const player = usePlayer();
  const [playlist, setPlaylist] = useState(initial);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(initial.name);
  const [busy, setBusy] = useState(false);
  const { tracks } = playlist;
  const source: MusicSource = { kind: "playlist", refId: playlist.id, title: playlist.name, tracks };

  const save = async (change: { name?: string; trackIds?: string[] }, done?: string) => {
    setBusy(true);
    try {
      setPlaylist(await api<PlaylistDetail>(apiPaths.playlist(playlist.id), { method: "PATCH", body: change }));
      if (done) toast(done);
      return true;
    } catch (err) {
      toast.error(errorText(err));
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

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= tracks.length) return;
    const next = [...tracks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setOrder(next);
  };
  const sortable = useSortable(move);

  const remove = (id: string) => {
    const before = tracks;
    setOrder(tracks.filter((t) => t.id !== id));
    toast("Removed from the playlist", { action: { label: "Undo", onClick: () => setOrder(before) } });
  };

  const del = async () => {
    setMenu(false);
    try {
      await api(apiPaths.playlist(playlist.id), { method: "DELETE" });
      toast(`Deleted ${playlist.name}`);
      router.push("/music?tab=playlists");
      router.refresh();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <>
      <BackRow>
        <button type="button" className="icon-btn" aria-label="Playlist options" onClick={() => setMenu(true)}>
          <MoreIcon />
        </button>
      </BackRow>
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
        <>
          <div className="actions">
            <button type="button" className="btn btn-primary btn-big" onClick={() => player.playMusic(source, 0)}>
              <PlayIcon size={22} />
              <span>Play</span>
            </button>
            <button type="button" className="btn-round" aria-label="Shuffle" onClick={() => player.playMusic(source, -1, true)}>
              <ShuffleIcon />
            </button>
          </div>
          <section className="section">
            <div ref={sortable.listRef} className={`list ${sortable.sorting ? "sorting" : ""}`}>
              {tracks.map((t, i) => {
                const row = sortable.rowProps(i);
                return (
                  <div key={t.id} data-row className={`queue-row${player.isCurrent("track", t.id) ? " playing" : ""} ${row.className}`} style={row.style}>
                    <button type="button" className="list-row-play" onClick={() => player.playMusic(source, i)}>
                      <Cover src={albumCover(t.albumId, t.coverHash)} color={null} title={t.album} className="thumb" />
                      <span className="list-row-main">
                        <span className="list-row-title">{t.title}</span>
                        <span className="list-row-sub">{songSub(t)}</span>
                      </span>
                    </button>
                    <span className="muted small">{songLength(t)}</span>
                    <SongMenuButton
                      track={t}
                      extra={(close) => (
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
                    <button
                      type="button"
                      className="icon-btn drag-handle"
                      aria-label={`Reorder ${t.title}. Use arrow keys to move.`}
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
          </section>
        </>
      ) : (
        <div className="empty" style={{ marginTop: 24 }}>
          <strong>No songs yet</strong>
          <div className="muted small">Add songs from the menu on any song, with Add to playlist.</div>
        </div>
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title={playlist.name}>
        <SheetItem
          onClick={() => {
            setMenu(false);
            setName(playlist.name);
            setRenaming(true);
          }}
        >
          Rename…
        </SheetItem>
        <SheetItem danger onClick={() => void del()}>
          Delete playlist
        </SheetItem>
      </Sheet>
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
