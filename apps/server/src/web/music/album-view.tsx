"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  albumCover,
  albumDiscs,
  type AlbumDetail,
  albumInMusic,
  albumPills,
  type ArtistDetail,
  artistImage,
  artistSub,
  guestArtist,
  plural,
  songLength,
  songNumber,
} from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { BackIcon, CheckIcon, MoreIcon, PlayIcon, PlusIcon, ShuffleIcon } from "../icons";
import { Sheet, SheetItem } from "../sheet";
import { type MusicSource, usePlayer } from "../player/engine";
import { ArtistPhotoDialog, AlbumMatchDialog } from "./match";
import { MineToggle, useMineChange } from "./mine";
import { AlbumCard, SongRow } from "./music-view";

/** Back to wherever you came from, or the Music tab when opened directly; `children` go on the right. */
export function BackRow({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  return (
    <div className="hero-bar back-row">
      <button type="button" className="icon-btn" aria-label="Back" onClick={() => (window.history.length > 1 ? router.back() : router.push("/music"))}>
        <BackIcon />
      </button>
      {children}
    </div>
  );
}

export function AlbumView({ album, isAdmin }: { album: AlbumDetail; isAdmin: boolean }) {
  const router = useRouter();
  const send = useMineChange();
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [matching, setMatching] = useState(false);
  const state = albumInMusic(album);
  const toAdd = album.trackCount - album.songsInMusic;
  const p = usePlayer();
  const source: MusicSource = { kind: "album", refId: album.id, title: album.title, tracks: album.tracks };

  const change = async (add: boolean) => {
    setBusy(true);
    await send(add, { albumIds: [album.id] });
    setBusy(false);
  };

  const revertMatch = async () => {
    setMenu(false);
    await api(`/api/music/albums/${album.id}/match`, { method: "DELETE" });
    toast("Match undone, using the files' details");
    router.refresh();
  };

  return (
    <>
      <BackRow>
        {state !== "none" || isAdmin ? (
          <button type="button" className="icon-btn" aria-label="Album options" onClick={() => setMenu(true)}>
            <MoreIcon />
          </button>
        ) : null}
      </BackRow>
      {/* Cover beside the title, as in the app. */}
      <div className="show-hero">
        <Cover src={albumCover(album.id, album.coverHash, 600)} color={album.coverColor} title={album.title} subtitle={album.artist} large />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 4, minWidth: 0 }}>
          <h1 className="show-title">{album.title}</h1>
          <Link className="book-author" href={`/music/artist/${album.artistId}`}>
            {album.artist}
          </Link>
          <div className="pills">
            {state === "all" ? (
              <span className="pill">
                <CheckIcon size={13} />
                In your music
              </span>
            ) : null}
            {albumPills(album).map((p) => (
              <span key={p} className="pill">
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>

      {state === "all" ? (
        <div className="actions">
          <button type="button" className="btn btn-primary btn-big" onClick={() => p.playMusic(source, 0)}>
            <PlayIcon size={22} />
            <span>Play</span>
          </button>
          <button type="button" className="btn-round" aria-label="Shuffle" onClick={() => p.playMusic(source, -1, true)}>
            <ShuffleIcon />
          </button>
        </div>
      ) : (
        <>
          <div className="actions">
            <button type="button" className="btn btn-primary btn-big" disabled={busy} onClick={() => change(true)}>
              <PlusIcon size={20} />
              <span>{state === "none" ? "Add to your music" : `Add the other ${plural(toAdd, "song")}`}</span>
            </button>
            <button type="button" className="btn-round" aria-label="Play" onClick={() => p.playMusic(source, 0)}>
              <PlayIcon />
            </button>
          </div>
          <p className="muted small" style={{ margin: "10px 0 0" }}>
            {state === "some" ? `${album.songsInMusic} of ${plural(album.trackCount, "song")} in your music. ` : ""}
            Tap + on any song to add just that one.
          </p>
        </>
      )}

      {albumDiscs(album.tracks).map((d) => (
        <section key={d.disc ?? 0} className="section">
          {d.disc !== null ? <h2 className="section-title">Disc {d.disc}</h2> : null}
          <ol className="track-list">
            {d.tracks.map((t, i) => (
              <li key={t.id} className={p.isCurrent("track", t.id) ? "playing" : undefined}>
                <span className="track-num">{songNumber(t, i)}</span>
                <span className="track-main">
                  <button type="button" className="track-title" onClick={() => p.playMusic(source, album.tracks.indexOf(t))}>
                    {t.title}
                  </button>
                  {guestArtist(t, album.artistId) ? (
                    <Link className="track-artist" href={`/music/artist/${t.artistId}`}>
                      {t.artist}
                    </Link>
                  ) : null}
                </span>
                <span className="muted small">{songLength(t)}</span>
                <MineToggle title={t.title} added={t.inMusic} change={{ trackIds: [t.id] }} />
              </li>
            ))}
          </ol>
        </section>
      ))}

      <Sheet open={menu} onClose={() => setMenu(false)} title={album.title}>
        {state !== "none" ? (
          <SheetItem
            danger
            onClick={() => {
              setMenu(false);
              void change(false);
            }}
          >
            {state === "all" ? "Remove from your music" : `Remove ${plural(album.songsInMusic, "song")} from your music`}
          </SheetItem>
        ) : null}
        {isAdmin ? (
          <SheetItem
            onClick={() => {
              setMenu(false);
              setMatching(true);
            }}
          >
            Match metadata…
          </SheetItem>
        ) : null}
        {isAdmin && album.match ? (
          <SheetItem danger onClick={() => void revertMatch()}>
            Undo match (use file metadata)
          </SheetItem>
        ) : null}
      </Sheet>

      {isAdmin && matching ? (
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
}

export function ArtistView({ artist, isAdmin }: { artist: ArtistDetail; isAdmin: boolean }) {
  const router = useRouter();
  const send = useMineChange();
  const p = usePlayer();
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [photo, setPhoto] = useState(false);
  const notFull = artist.albums.filter((a) => albumInMusic(a) !== "all");
  const anyAdded = artist.albums.some((a) => albumInMusic(a) !== "none");

  return (
    <>
      <BackRow>
        {isAdmin ? (
          <button type="button" className="icon-btn" aria-label="Artist options" onClick={() => setMenu(true)}>
            <MoreIcon />
          </button>
        ) : null}
      </BackRow>
      <div className="artist-head">
        <Cover className="artist-photo" src={artistImage(artist, 600)} color={null} title={artist.name} />
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">{artist.name}</h1>
          <div className="page-sub">{artistSub(artist)}</div>
        </div>
      </div>
      <Sheet open={menu} onClose={() => setMenu(false)} title={artist.name}>
        <SheetItem
          onClick={() => {
            setMenu(false);
            setPhoto(true);
          }}
        >
          Change photo…
        </SheetItem>
      </Sheet>
      {isAdmin && photo ? <ArtistPhotoDialog artist={artist} onClose={() => setPhoto(false)} onChanged={() => router.refresh()} /> : null}
      {notFull.length ? (
        <button
          type="button"
          className="btn btn-outline add-all"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await send(true, { albumIds: notFull.map((a) => a.id) });
            setBusy(false);
          }}
        >
          <PlusIcon size={18} />
          {anyAdded ? `Add the other ${plural(notFull.length, "album")}` : `Add all ${plural(notFull.length, "album")}`}
        </button>
      ) : null}
      {artist.albums.length ? (
        <div className="grid" style={{ marginTop: 16 }}>
          {artist.albums.map((a) => (
            <AlbumCard key={a.id} album={a} sub={a.year ?? plural(a.trackCount, "song")} badge />
          ))}
        </div>
      ) : null}
      {artist.appearsOn.length ? (
        <section className="section">
          <h2 className="section-title">
            Appears on
            <span className="count-pill" aria-label={plural(artist.appearsOn.length, "song")}>
              {artist.appearsOn.length}
            </span>
          </h2>
          <div className="list">
            {artist.appearsOn.map((t) => (
              <SongRow
                key={t.id}
                track={t}
                sub={t.album}
                toggle
                onPlay={() => p.playMusic({ kind: "artist", refId: artist.id, title: artist.name, tracks: artist.appearsOn }, artist.appearsOn.indexOf(t))}
              />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
