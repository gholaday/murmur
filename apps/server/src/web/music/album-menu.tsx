"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { type AlbumDetail, albumInMusic, type AlbumSummary } from "@murmur/shared/client";
import { useAdmin } from "../admin";
import { api } from "../api";
import { CardMenu, MenuItem, MenuSep } from "../card-menu";
import { usePlayerControls } from "../player/engine";
import { AlbumMatchDialog } from "./match";
import { useMineChange } from "./mine";
import { AddToPlaylistSheet } from "./song-menu";

const loadAlbum = (id: string) => api<AlbumDetail>(`/api/music/albums/${id}`);

/**
 * An album's menu, the same on its card and its page: Play, Up Next, a playlist, its artist and
 * your music, then for admins Match. The songs are fetched only when an item needs them.
 */
export function AlbumMenuItems({
  album,
  choose,
  onAddToPlaylist,
  onMatch,
}: {
  album: AlbumSummary;
  choose: (fn: () => unknown) => () => void;
  onAddToPlaylist: (trackIds: string[]) => void;
  onMatch: () => void;
}) {
  const router = useRouter();
  const { isAdmin } = useAdmin();
  const p = usePlayerControls();
  const send = useMineChange();
  const inMusic = albumInMusic(album);
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
            "next",
          );
          toast("Added to Up Next");
        })}
      >
        Add to Up Next
      </MenuItem>
      <MenuItem onClick={choose(async () => onAddToPlaylist((await loadAlbum(album.id)).tracks.map((t) => t.id)))}>Add to playlist…</MenuItem>
      <MenuItem onClick={choose(() => router.push(`/music/artist/${album.artistId}`))}>Go to {album.artist}</MenuItem>
      <MenuItem danger={inMusic !== "none"} onClick={choose(() => send(inMusic === "none", { albumIds: [album.id] }))}>
        {inMusic === "none" ? "Add to your music" : "Remove from your music"}
      </MenuItem>
      {isAdmin ? (
        <>
          <MenuSep />
          <MenuItem onClick={choose(onMatch)}>Match…</MenuItem>
        </>
      ) : null}
    </>
  );
}

/** The album's sheets that its menu opens: Add to playlist and Match. */
export function useAlbumMenuSheets(album: AlbumSummary) {
  const router = useRouter();
  const [adding, setAdding] = useState<string[] | null>(null);
  const [matching, setMatching] = useState(false);
  const sheets = (
    <>
      <AddToPlaylistSheet open={adding !== null} onClose={() => setAdding(null)} title={album.title} trackIds={adding ?? []} />
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
  return { onAddToPlaylist: setAdding, onMatch: () => setMatching(true), sheets };
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
