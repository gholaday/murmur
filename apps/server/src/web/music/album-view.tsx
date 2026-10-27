"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { albumCover, albumDiscs, type AlbumDetail, albumPills, type ArtistDetail, artistSub, guestArtist, plural, songLength, songNumber } from "@murmur/shared/client";
import { Cover } from "../cover";
import { BackIcon, PlayIcon, ShuffleIcon } from "../icons";
import { AlbumCard, SongRow } from "./music-view";

/** Back to wherever you came from, or the Music tab when opened directly. */
function BackRow() {
  const router = useRouter();
  return (
    <div className="hero-bar">
      <button type="button" className="icon-btn" aria-label="Back" onClick={() => (window.history.length > 1 ? router.back() : router.push("/music"))}>
        <BackIcon />
      </button>
    </div>
  );
}


export function AlbumView({ album }: { album: AlbumDetail }) {
  const coverSrc = albumCover(album.id, album.coverHash, 600);
  return (
    <>
      <BackRow />
      <div className="book-hero">
        <Cover src={coverSrc} color={album.coverColor} title={album.title} subtitle={album.artist} large />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <h1 className="book-title">{album.title}</h1>
          <div className="book-by">
            <Link className="book-author" href={`/music/artist/${album.artistId}`}>
              {album.artist}
            </Link>
          </div>
          <div className="pills">
            {albumPills(album).map((p) => (
              <span key={p} className="pill">
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Playing music comes with the music player. */}
      <div className="actions">
        <button type="button" className="btn btn-primary btn-big" disabled title="Coming with the music player">
          <PlayIcon size={22} />
          <span>Play</span>
        </button>
        <button type="button" className="btn-round" aria-label="Shuffle" disabled title="Coming with the music player">
          <ShuffleIcon />
        </button>
      </div>

      {albumDiscs(album.tracks).map((d) => (
        <section key={d.disc ?? 0} className="section">
          {d.disc !== null ? <h2 className="section-title">Disc {d.disc}</h2> : null}
          <ol className="track-list">
            {d.tracks.map((t, i) => (
              <li key={t.id}>
                <span className="track-num">{songNumber(t, i)}</span>
                <span className="track-main">
                  <span className="track-title">{t.title}</span>
                  {guestArtist(t, album.artistId) ? (
                    <Link className="track-artist" href={`/music/artist/${t.artistId}`}>
                      {t.artist}
                    </Link>
                  ) : null}
                </span>
                <span className="muted small">{songLength(t)}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

export function ArtistView({ artist }: { artist: ArtistDetail }) {
  return (
    <>
      <BackRow />
      <div className="page-head" style={{ marginTop: 8 }}>
        <div>
          <h1 className="page-title">{artist.name}</h1>
          <div className="page-sub">
            {artistSub(artist)}
          </div>
        </div>
      </div>
      {artist.albums.length ? (
        <div className="grid">
          {artist.albums.map((a) => (
            <AlbumCard key={a.id} album={a} sub={a.year ?? plural(a.trackCount, "song")} />
          ))}
        </div>
      ) : null}
      {artist.appearsOn.length ? (
        <section className="section">
          <h2 className="section-title">Appears on</h2>
          <div className="list">
            {artist.appearsOn.map((t) => (
              <SongRow key={t.id} track={t} sub={t.album} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
