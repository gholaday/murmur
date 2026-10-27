"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ALBUM_SORTS,
  type AlbumSort,
  type AlbumSummary,
  albumCover,
  albumMatches,
  apiPaths,
  artistMatches,
  artistSub,
  type ArtistSummary,
  songLength,
  songMatches,
  songSub,
  sortAlbums,
  plural,
  type TrackDto,
} from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { FilterIcon, SearchIcon } from "../icons";
import { Sheet, SheetItem } from "../sheet";

export type MusicTab = "albums" | "artists" | "songs";
const TABS: Array<{ id: MusicTab; label: string }> = [
  { id: "albums", label: "Albums" },
  { id: "artists", label: "Artists" },
  { id: "songs", label: "Songs" },
];
const SORT_KEY = "murmur.albumSort";

export function AlbumCard({ album, sub }: { album: AlbumSummary; sub?: string }) {
  return (
    <div className="card">
      <Link href={`/music/album/${album.id}`} className="card-link">
        <div className="card-cover">
          <Cover
            src={albumCover(album.id, album.coverHash)}
            color={album.coverColor}
            title={album.title}
            subtitle={album.artist}
          />
        </div>
        <div className="card-title">{album.title}</div>
        <div className="card-sub">{sub ?? album.artist}</div>
      </Link>
    </div>
  );
}

export function SongRow({ track, sub }: { track: TrackDto; sub?: string }) {
  return (
    <Link href={`/music/album/${track.albumId}`} className="list-row">
      <Cover
        src={albumCover(track.albumId, track.coverHash)}
        color={null}
        title={track.album}
        className="thumb"
      />
      <span className="list-row-main">
        <span className="list-row-title">{track.title}</span>
        <span className="list-row-sub">{sub ?? songSub(track)}</span>
      </span>
      <span className="muted small">{songLength(track)}</span>
    </Link>
  );
}

/** The Music tab: albums, artists or songs, with search and an album sort. */
export function MusicView({ albums, artists, tab: initialTab }: { albums: AlbumSummary[]; artists: ArtistSummary[]; tab: MusicTab }) {
  const pathname = usePathname();
  const [tab, setTab] = useState<MusicTab>(initialTab);
  const [sort, setSort] = useState<AlbumSort>("added");
  const [sortOpen, setSortOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState<TrackDto[] | null>(null);
  const q = query.trim().toLowerCase();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SORT_KEY) as AlbumSort | null;
      if (saved && ALBUM_SORTS.some((s) => s.id === saved)) setSort(saved);
    } catch {
      // private mode
    }
  }, []);

  // Songs load the first time they're shown; albums and artists come with the page.
  useEffect(() => {
    if (tab !== "songs" || songs) return;
    api<TrackDto[]>(apiPaths.tracks()).then(setSongs, () => setSongs([]));
  }, [tab, songs]);

  const switchTab = (next: MusicTab) => {
    setTab(next);
    window.history.replaceState(null, "", next === "albums" ? pathname : `${pathname}?tab=${next}`);
  };

  const sorted = useMemo(() => sortAlbums(albums, sort), [albums, sort]);
  const shownAlbums = sorted.filter((a) => albumMatches(a, q));
  const shownArtists = artists.filter((a) => artistMatches(a, q));
  const shownSongs = (songs ?? []).filter((t) => songMatches(t, q));

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          Music
          <span className="count-pill" aria-label={plural(albums.length, "album")}>
            {albums.length}
          </span>
        </h1>
        <div className="head-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label="Search"
            aria-pressed={searching}
            onClick={() => {
              setSearching((s) => !s);
              setQuery("");
            }}
          >
            <SearchIcon />
          </button>
          {tab === "albums" ? (
            <button type="button" className="icon-btn" aria-label="Sort" onClick={() => setSortOpen(true)}>
              <FilterIcon />
            </button>
          ) : null}
        </div>
      </div>

      {searching ? (
        <div className="search">
          <SearchIcon />
          <input
            className="input"
            type="search"
            placeholder={tab === "songs" ? "Song, artist or album" : tab === "artists" ? "Artist" : "Album or artist"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search music"
            autoFocus
          />
        </div>
      ) : null}

      <div className="chips" role="tablist" aria-label="Music view">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" className="chip" aria-selected={tab === t.id} aria-pressed={tab === t.id} onClick={() => switchTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        {tab === "albums" ? (
          shownAlbums.length ? (
            <div className="grid">
              {shownAlbums.map((a) => (
                <AlbumCard key={a.id} album={a} />
              ))}
            </div>
          ) : (
            <div className="empty">{q ? "No albums match." : "No albums yet."}</div>
          )
        ) : tab === "artists" ? (
          shownArtists.length ? (
            <div className="list">
              {shownArtists.map((a) => (
                <Link key={a.id} href={`/music/artist/${a.id}`} className="list-row">
                  <Cover
                    src={a.coverAlbumId ? albumCover(a.coverAlbumId, a.coverHash) : null}
                    color={null}
                    title={a.name}
                    className="thumb round"
                  />
                  <span className="list-row-main">
                    <span className="list-row-title">{a.name}</span>
                    <span className="list-row-sub">{artistSub(a)}</span>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty">{q ? "No artists match." : "No artists yet."}</div>
          )
        ) : songs === null ? (
          <div className="empty">Loading songs…</div>
        ) : shownSongs.length ? (
          <div className="list">
            {shownSongs.map((t) => (
              <SongRow key={t.id} track={t} />
            ))}
          </div>
        ) : (
          <div className="empty">{q ? "No songs match." : "No songs yet."}</div>
        )}
      </div>

      <Sheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort albums">
        {ALBUM_SORTS.map((s) => (
          <SheetItem
            key={s.id}
            active={sort === s.id}
            onClick={() => {
              setSort(s.id);
              setSortOpen(false);
              try {
                localStorage.setItem(SORT_KEY, s.id);
              } catch {
                // private mode
              }
            }}
          >
            {s.label}
          </SheetItem>
        ))}
      </Sheet>
    </>
  );
}
