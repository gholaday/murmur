"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiPaths, errorText, type PlaylistDetail, type PlaylistSummary, plural, type TrackDto } from "@murmur/shared/client";
import { api } from "../api";
import { MoreIcon } from "../icons";
import { usePlayer } from "../player/engine";
import { Sheet, SheetItem } from "../sheet";

/** A song's ⋯ button: play next, add to Up Next or a playlist, go to its album, and any `extra` items. */
export function SongMenuButton({
  track,
  hideAlbum,
  extra,
}: {
  track: TrackDto;
  /** On the album's own page, where "Go to album" goes nowhere. */
  hideAlbum?: boolean;
  /** More items at the end, given a function that closes the menu. */
  extra?: (close: () => void) => React.ReactNode;
}) {
  const router = useRouter();
  const player = usePlayer();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const close = () => setOpen(false);
  const run = (fn: () => Promise<void>, done: string) => {
    close();
    fn().then(
      () => toast(done),
      (err: unknown) => toast.error(errorText(err)),
    );
  };

  return (
    <>
      <button type="button" className="icon-btn dim" aria-label={`More for ${track.title}`} onClick={() => setOpen(true)}>
        <MoreIcon size={18} />
      </button>
      <Sheet open={open} onClose={close} title={track.title}>
        <SheetItem onClick={() => run(() => player.playNext(track), "Playing next")}>Play next</SheetItem>
        <SheetItem onClick={() => run(() => player.queueAdd({ itemType: "track", itemId: track.id }, "last"), "Added to Up Next")}>
          Add to Up Next
        </SheetItem>
        <SheetItem
          onClick={() => {
            close();
            setAdding(true);
          }}
        >
          Add to playlist…
        </SheetItem>
        {hideAlbum ? null : (
          <SheetItem
            onClick={() => {
              close();
              router.push(`/music/album/${track.albumId}`);
            }}
          >
            Go to album
          </SheetItem>
        )}
        {extra?.(close)}
      </Sheet>
      <AddToPlaylistSheet open={adding} onClose={() => setAdding(false)} title={track.title} trackIds={[track.id]} />
    </>
  );
}

/** Pick one of your playlists to add songs to, or make a new one with them. */
export function AddToPlaylistSheet({ open, onClose, title, trackIds }: { open: boolean; onClose: () => void; title: string; trackIds: string[] }) {
  const router = useRouter();
  const [lists, setLists] = useState<PlaylistSummary[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNaming(false);
    setName("");
    api<PlaylistSummary[]>(apiPaths.playlists).then(setLists, (err: unknown) => {
      toast.error(errorText(err));
      setLists([]);
    });
  }, [open]);

  const done = (p: PlaylistDetail, verb: string) => {
    onClose();
    router.refresh();
    toast(`${verb} ${p.name}`, { action: { label: "Open", onClick: () => router.push(`/music/playlist/${p.id}`) } });
  };

  const add = async (p: PlaylistSummary) => {
    setBusy(true);
    try {
      done(await api<PlaylistDetail>(apiPaths.playlistTracks(p.id), { method: "POST", body: { trackIds } }), "Added to");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      done(await api<PlaylistDetail>(apiPaths.playlists, { method: "POST", body: { name: name.trim(), trackIds } }), "Made");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={`Add ${trackIds.length === 1 ? title : plural(trackIds.length, "song")} to a playlist`}>
      {naming ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void create();
          }}
        >
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Playlist name" aria-label="Playlist name" autoFocus />
          <button type="submit" className="btn btn-primary btn-big" disabled={busy || !name.trim()}>
            {busy ? "Making…" : "Make playlist"}
          </button>
        </form>
      ) : (
        <>
          <SheetItem onClick={() => setNaming(true)}>New playlist…</SheetItem>
          {lists === null ? (
            <div className="loading-center" aria-busy="true" aria-label="Loading">
              <div className="spinner" />
            </div>
          ) : (
            lists.map((p) => (
              <SheetItem key={p.id} disabled={busy} onClick={() => void add(p)}>
                {p.name}
              </SheetItem>
            ))
          )}
        </>
      )}
    </Sheet>
  );
}
