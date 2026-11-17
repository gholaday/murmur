"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  albumCover,
  albumDiscs,
  type AlbumDetail,
  albumFacts,
  type ArtistDetail,
  FALLBACK_TINT,
  artistImage,
  artistSub,
  guestArtist,
  plural,
  songLength,
  songNumber,
  songSub,
} from "@murmur/shared/client";
import { useAdmin } from "../admin";
import { Cover } from "../cover";
import { MoreIcon, PauseIcon, PlayIcon } from "../icons";
import { ShuffleButton } from "./shuffle-button";
import { MixerBars } from "../mixer";
import { BackRow, HeroBar, SectionTitle } from "../ui";
import { type MusicSource, usePlayerControls, usePlayerSelect } from "../player/engine";
import { MenuItem, MenuSheet } from "../card-menu";
import { HideMenuItem, useLeave } from "../hidden";
import { AlbumMenuItems, useAlbumMenuSheets } from "./album-menu";
import { ArtistPhotoDialog } from "./match";
import { LikeButton } from "./likes";
import { SongMenuButton } from "./song-menu";
import { AlbumCard } from "./music-view";
import { SongRow } from "./song-row";

export function AlbumView({ album }: { album: AlbumDetail }) {
  const leave = useLeave();
  const [menu, setMenu] = useState(false);
  const menuSheets = useAlbumMenuSheets(album);
  const p = usePlayerControls();
  const coverSrc = albumCover(album.id, album.coverHash, 600);
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

  return (
    <>
      {/* Laid out like a book's page: the cover over its title, artist and facts. */}
      <div
        className="hero"
        style={
          {
            "--tint": album.coverColor ?? FALLBACK_TINT.page,
            "--art": coverSrc ? `url("${coverSrc}")` : "none",
          } as React.CSSProperties
        }
      >
        <HeroBar fallback="/music" onMore={() => setMenu(true)} />
        <div className="book-hero">
          <Cover src={coverSrc} color={album.coverColor} title={album.title} subtitle={album.artist} large />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <h1 className="book-title">{album.title}</h1>
            <div className="book-by">
              <Link className="book-author" href={`/music/artist/${album.artistId}`}>
                {album.artist}
              </Link>
            </div>
            <div className="book-meta">
              {albumFacts(album).map((f) => (
                <span key={f}>{f}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="actions">
        <button type="button" className="btn btn-primary btn-big" onClick={onPlay}>
          {from && playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
          <span>{from ? (playing ? "Pause" : "Resume") : "Play"}</span>
        </button>
        <ShuffleButton source={source} />
        <LikeButton round size={22} title={album.title} liked={!!album.liked} change={{ albumIds: [album.id] }} />
      </div>

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
                <span className="muted small">{songLength(t)}</span>
                <LikeButton title={t.title} liked={!!t.liked} change={{ trackIds: [t.id] }} />
                <SongMenuButton track={t} hideAlbum />
              </li>
            ))}
          </ol>
        </section>
      ))}

      <MenuSheet
        open={menu}
        onClose={() => setMenu(false)}
        title={album.title}
        items={(choose) => (
          <AlbumMenuItems album={album} choose={choose} onAddToPlaylist={menuSheets.onAddToPlaylist} onMatch={menuSheets.onMatch} after={leave("/music?tab=albums")} />
        )}
      />
      {menuSheets.sheets}
    </>
  );
}

export function ArtistView({ artist }: { artist: ArtistDetail }) {
  const router = useRouter();
  const leave = useLeave();
  const { isAdmin } = useAdmin();
  const p = usePlayerControls();
  const [menu, setMenu] = useState(false);
  const [photo, setPhoto] = useState(false);

  return (
    <>
      <BackRow fallback="/music">
        <button type="button" className="icon-btn" aria-label="Artist options" onClick={() => setMenu(true)}>
          <MoreIcon />
        </button>
      </BackRow>
      <div className="artist-head">
        <Cover className="artist-photo" src={artistImage(artist, 600)} color={null} title={artist.name} />
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">{artist.name}</h1>
          <div className="page-sub">{artistSub(artist)}</div>
        </div>
      </div>
      <MenuSheet
        open={menu}
        onClose={() => setMenu(false)}
        title={artist.name}
        items={(choose) => (
          <>
            {isAdmin ? <MenuItem onClick={choose(() => setPhoto(true))}>Change photo…</MenuItem> : null}
            <HideMenuItem change={{ kind: "artist", id: artist.id }} title={artist.name} choose={choose} after={leave("/music?tab=artists")} divider={isAdmin} />
          </>
        )}
      />
      {isAdmin && photo ? <ArtistPhotoDialog artist={artist} onClose={() => setPhoto(false)} onChanged={() => router.refresh()} /> : null}
      {artist.albums.length ? (
        <div className="grid" style={{ marginTop: 16 }}>
          {artist.albums.map((a) => (
            <AlbumCard key={a.id} album={a} sub={a.year ?? plural(a.trackCount, "song")} />
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
                onPlay={() => p.playMusic({ kind: "artist", refId: artist.id, title: artist.name, tracks: artist.appearsOn }, artist.appearsOn.indexOf(t))}
              />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
