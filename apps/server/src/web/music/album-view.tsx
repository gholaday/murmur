"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  albumCover,
  albumDiscs,
  type AlbumDetail,
  albumInMusic,
  albumPills,
  type ArtistDetail,
  artistSub,
  guestArtist,
  plural,
  songLength,
  songNumber,
} from "@murmur/shared/client";
import { Cover } from "../cover";
import { BackIcon, CheckIcon, MoreIcon, PlayIcon, PlusIcon, ShuffleIcon } from "../icons";
import { Sheet, SheetItem } from "../sheet";
import { type MusicSource, usePlayer } from "../player/engine";
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

export function AlbumView({ album }: { album: AlbumDetail }) {
  const send = useMineChange();
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const state = albumInMusic(album);
  const toAdd = album.trackCount - album.songsInMusic;
  const p = usePlayer();
  const source: MusicSource = { kind: "album", refId: album.id, title: album.title, tracks: album.tracks };

  const change = async (add: boolean) => {
    setBusy(true);
    await send(add, { albumIds: [album.id] });
    setBusy(false);
  };

  return (
    <>
      <BackRow>
        {state !== "none" ? (
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
        <SheetItem
          danger
          onClick={() => {
            setMenu(false);
            void change(false);
          }}
        >
          {state === "all" ? "Remove from your music" : `Remove ${plural(album.songsInMusic, "song")} from your music`}
        </SheetItem>
      </Sheet>
    </>
  );
}

export function ArtistView({ artist }: { artist: ArtistDetail }) {
  const send = useMineChange();
  const p = usePlayer();
  const [busy, setBusy] = useState(false);
  const notFull = artist.albums.filter((a) => albumInMusic(a) !== "all");
  const anyAdded = artist.albums.some((a) => albumInMusic(a) !== "none");

  return (
    <>
      <BackRow />
      <div className="page-head">
        <div>
          <h1 className="page-title">{artist.name}</h1>
          <div className="page-sub">{artistSub(artist)}</div>
        </div>
      </div>
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
