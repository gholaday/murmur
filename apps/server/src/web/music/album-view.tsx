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
  artistImage,
  artistSub,
  FALLBACK_TINT,
  guestArtist,
  plural,
  songLength,
  songNumber,
  songSub,
} from "@murmur/shared/client";
import { useAdmin } from "../admin";
import { Cover } from "../cover";
import { CheckIcon, MoreIcon, PauseIcon, PlayIcon, PlusIcon } from "../icons";
import { ShuffleButton } from "./shuffle-button";
import { MixerBars } from "../mixer";
import { BackRow, SectionTitle } from "../ui";
import { Sheet, SheetItem } from "../sheet";
import { type MusicSource, usePlayerControls, usePlayerSelect } from "../player/engine";
import { MenuSheet } from "../card-menu";
import { AlbumMenuItems, useAlbumMenuSheets } from "./album-menu";
import { ArtistPhotoDialog } from "./match";
import { MineToggle, useMineChange } from "./mine";
import { SongMenuButton } from "./song-menu";
import { AlbumCard } from "./music-view";
import { SongQueueButton, SongRow } from "./song-row";

export function AlbumView({ album }: { album: AlbumDetail }) {
  const send = useMineChange();
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuSheets = useAlbumMenuSheets(album);
  const state = albumInMusic(album);
  const toAdd = album.trackCount - album.songsInMusic;
  const p = usePlayerControls();
  const source: MusicSource = { kind: "album", refId: album.id, title: album.title, tracks: album.tracks };
  const from = usePlayerSelect((s) => s.isPlayingFrom("album", album.id));
  const nowId = usePlayerSelect((s) => (s.item?.type === "track" ? s.item.id : null));
  const nowHere = nowId !== null && album.tracks.some((t) => t.id === nowId);
  // Only while this album's song is loaded, so other music playing doesn't re-render the list.
  const playing = usePlayerSelect((s) => (from || nowHere) && s.playing);
  // Starting the album opens the full player; pausing and resuming leave it as it is.
  const onPlay = () => {
    if (from) return p.toggle();
    p.playMusic(source, -1);
    p.setExpanded(true);
  };

  const change = async (add: boolean) => {
    setBusy(true);
    await send(add, { albumIds: [album.id] });
    setBusy(false);
  };

  return (
    <>
      {/* Wide screens with room (hero.css, music.css): the album on the left, staying in view, and its songs on the right. */}
      <div className="detail album-detail" style={{ "--tint": album.coverColor ?? FALLBACK_TINT.page } as React.CSSProperties}>
        <div className="detail-main">
          <BackRow fallback="/music">
            <button type="button" className="icon-btn" aria-label="More options" onClick={() => setMenu(true)}>
              <MoreIcon />
            </button>
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
              <button type="button" className="btn btn-primary btn-big" onClick={onPlay}>
                {from && playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
                <span>{from ? (playing ? "Pause" : "Resume") : "Play"}</span>
              </button>
              <ShuffleButton source={source} />
              {/* Wide screens only; phones remove it from the ⋯ menu. */}
              <button type="button" className="btn-round album-mine" aria-label={`Remove ${album.title} from your music`} disabled={busy} onClick={() => change(false)}>
                <CheckIcon />
              </button>
            </div>
          ) : (
            <>
              <div className="actions">
                <button type="button" className="btn btn-primary btn-big" disabled={busy} onClick={() => change(true)}>
                  <PlusIcon size={20} />
                  <span>{state === "none" ? "Add to your music" : `Add the other ${plural(toAdd, "song")}`}</span>
                </button>
                <button
                  type="button"
                  className="btn-round"
                  aria-label={from && playing ? "Pause" : "Play"}
                  onClick={onPlay}
                >
                  {from && playing ? <PauseIcon /> : <PlayIcon />}
                </button>
              </div>
              {state === "some" ? (
                <p className="muted small" style={{ margin: "10px 0 0" }}>
                  {`${album.songsInMusic} of ${plural(album.trackCount, "song")} in your music`}
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="album-tracks">
          {albumDiscs(album.tracks).map((d) => (
            <section key={d.disc ?? 0} className="section">
              {d.disc !== null ? <h2 className="section-title">Disc {d.disc}</h2> : null}
              <ol className="track-list">
                {d.tracks.map((t, i) => (
                  <li key={t.id} className={nowId === t.id ? "playing" : undefined}>
                    <span className="track-num">{nowId === t.id ? <MixerBars playing={playing} /> : songNumber(t, i)}</span>
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
                    <span className="muted small song-len">{songLength(t)}</span>
                    <MineToggle title={t.title} added={t.inMusic} change={{ trackIds: [t.id] }} />
                    <SongQueueButton track={t} current={nowId === t.id} />
                    <SongMenuButton track={t} hideAlbum />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>

      <MenuSheet
        open={menu}
        onClose={() => setMenu(false)}
        title={album.title}
        items={(choose) => <AlbumMenuItems album={album} choose={choose} onAddToPlaylist={menuSheets.onAddToPlaylist} onMatch={menuSheets.onMatch} />}
      />
      {menuSheets.sheets}
    </>
  );
}

export function ArtistView({ artist }: { artist: ArtistDetail }) {
  const router = useRouter();
  const { isAdmin } = useAdmin();
  const send = useMineChange();
  const p = usePlayerControls();
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [photo, setPhoto] = useState(false);
  const notFull = artist.albums.filter((a) => albumInMusic(a) !== "all");
  const anyAdded = artist.albums.some((a) => albumInMusic(a) !== "none");
  const addedCount = artist.albums.length - notFull.length;

  return (
    <>
      <BackRow fallback="/music">
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
          <div className="page-sub">{addedCount ? `${artistSub(artist)}, ${addedCount} in your music` : artistSub(artist)}</div>
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
          {anyAdded ? `Add the other ${plural(notFull.length, "album")}` : notFull.length === 1 ? "Add the album" : `Add all ${plural(notFull.length, "album")}`}
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
          <SectionTitle title="Appears on" count={artist.appearsOn.length} noun="song" />
          <div className="list">
            {artist.appearsOn.map((t) => (
              <SongRow
                key={t.id}
                track={t}
                sub={songSub(t)}
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
