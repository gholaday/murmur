"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "../toast";
import { type AlbumDetail, type AlbumSummary, apiPaths } from "@murmur/shared/client";
import { useAdmin } from "../admin";
import { api } from "../api";
import { CardMenu, MenuItem, MenuSep } from "../card-menu";
import { HideMenuItem } from "../hidden";
import { usePlayerControls } from "../player/engine";
import { AlbumMatchDialog } from "./match";
import { AddToPlaylistSheet } from "./song-menu";

const loadAlbum = (id: string) => api<AlbumDetail>(apiPaths.album(id));

/**
 * An album's menu, the same on its card and its page: Play, Up Next, a playlist and its artist,
 * then for admins Match, then Hide. The songs are fetched only when an item needs them.
 */
export function AlbumMenuItems({
  album,
  choose,
  onAddToPlaylist,
  onMatch,
  after,
}: {
  album: AlbumSummary;
  choose: (fn: () => unknown) => () => void;
  onAddToPlaylist: (trackIds: string[]) => void;
  onMatch: () => void;
  /** Runs once the album is hidden: its own page goes back. */
  after?: () => void;
}) {
  const router = useRouter();
  const { isAdmin } = useAdmin();
  const p = usePlayerControls();
  return (
    <>
      <MenuItem
        onClick={choose(async () => {
          const a = await loadAlbum(album.id);
          p.playMusic({ kind: "album", refId: a.id, title: a.title, tracks: a.tracks }, -1);
          p.setExpanded(true);
        })}
      >
        Play
      </MenuItem>
      <MenuItem
        onClick={choose(async () => {
          const a = await loadAlbum(album.id);
          await p.addToUpNext(
            a.tracks.map((t) => ({ itemType: "track", itemId: t.id })),
            "last",
          );
          toast("Added to queue");
        })}
      >
        Add to queue
      </MenuItem>
      <MenuItem onClick={choose(async () => onAddToPlaylist((await loadAlbum(album.id)).tracks.map((t) => t.id)))}>Add to playlist…</MenuItem>
      <MenuItem onClick={choose(() => router.push(`/music/artist/${album.artistId}`))}>Go to {album.artist}</MenuItem>
      {isAdmin ? (
        <>
          <MenuSep />
          <MenuItem onClick={choose(onMatch)}>Match…</MenuItem>
        </>
      ) : null}
      <HideMenuItem change={{ kind: "album", id: album.id }} title={album.title} choose={choose} after={after} />
    </>
  );
}

/** The album's sheets that its menu opens: Add to playlist and Match. */
export function useAlbumMenuSheets(album: AlbumSummary) {
  const router = useRouter();
  const [adding, setAdding] = useState<string[] | null>(null);
  // Mounted once it's needed, since a page can have hundreds of album cards.
  const [added, setAdded] = useState(false);
  const [matching, setMatching] = useState(false);
  const onAddToPlaylist = (trackIds: string[]) => {
    setAdded(true);
    setAdding(trackIds);
  };
  const sheets = (
    <>
      {added ? <AddToPlaylistSheet open={adding !== null} onClose={() => setAdding(null)} title={album.title} trackIds={adding ?? []} /> : null}
      {matching ? (
        <AlbumMatchDialog
          album={album}
          onClose={() => setMatching(false)}
          onApplied={() => {
            setMatching(false);
            toast("Match applied");
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
  return { onAddToPlaylist, onMatch: () => setMatching(true), sheets };
}

export function AlbumCardMenu({ album }: { album: AlbumSummary }) {
  const { onAddToPlaylist, onMatch, sheets } = useAlbumMenuSheets(album);
  return (
    <>
      <CardMenu label={album.title} items={(choose) => <AlbumMenuItems album={album} choose={choose} onAddToPlaylist={onAddToPlaylist} onMatch={onMatch} />} />
      {sheets}
    </>
  );
}
