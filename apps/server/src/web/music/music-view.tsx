"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ALBUM_SORTS,
  type AlbumSort,
  type AlbumSummary,
  albumCover,
  albumInMusic,
  albumInMusicLabel,
  albumMatches,
  albumsByArtist,
  apiPaths,
  type ArtistSummary,
  artistMatches,
  type MusicSummaryDto,
  type PlaylistSummary,
  plural,
  songLength,
  songMatches,
  songSub,
  sortAlbums,
  type TrackDto,
} from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { ChevronIcon, CloseIcon, FilterIcon, FolderIcon, MusicIcon, PlayIcon, SearchIcon, ShuffleIcon } from "../icons";
import { type MusicSource, usePlayer } from "../player/engine";
import { GroupGrid } from "../library/library";
import { Sheet, SheetItem } from "../sheet";
import { AlbumBadge, MineToggle, useMineChange } from "./mine";
import { NewPlaylistButton, PlaylistCard } from "./playlist-view";
import { SongMenuButton } from "./song-menu";

export type MusicTab = "albums" | "artists" | "songs" | "playlists";
const TABS: Array<{ id: MusicTab; label: string; placeholder: string }> = [
  { id: "playlists", label: "Playlists", placeholder: "Playlist" },
  { id: "albums", label: "Albums", placeholder: "Album or artist" },
  { id: "artists", label: "Artists", placeholder: "Artist" },
  { id: "songs", label: "Songs", placeholder: "Song, artist or album" },
];
const SORT_KEY = "murmur.albumSort";

/** The album sort, kept in this browser and shared by the Music tab and Browse. */
export function useAlbumSort(): [AlbumSort, (s: AlbumSort) => void] {
  const [sort, setSort] = useState<AlbumSort>("added");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SORT_KEY) as AlbumSort | null;
      if (saved && ALBUM_SORTS.some((s) => s.id === saved)) setSort(saved);
    } catch {
      // private mode
    }
  }, []);
  const save = (next: AlbumSort) => {
    setSort(next);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {
      // private mode
    }
  };
  return [sort, save];
}

export function AlbumSortSheet({ open, onClose, sort, onPick }: { open: boolean; onClose: () => void; sort: AlbumSort; onPick: (s: AlbumSort) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Sort albums">
      {ALBUM_SORTS.map((s) => (
        <SheetItem
          key={s.id}
          active={sort === s.id}
          onClick={() => {
            onPick(s.id);
            onClose();
          }}
        >
          {s.label}
        </SheetItem>
      ))}
    </Sheet>
  );
}

/** Cover with title and a sub line; `badge` puts the add / added button on the cover. */
export function AlbumCard({ album, sub, badge }: { album: AlbumSummary; sub?: string | null; badge?: boolean }) {
  return (
    <div className="card">
      <div className="card-cover">
        <Link href={`/music/album/${album.id}`} aria-label={`${album.title}, ${album.artist}`} tabIndex={-1}>
          <Cover src={albumCover(album.id, album.coverHash)} color={album.coverColor} title={album.title} subtitle={album.artist} />
        </Link>
        {badge ? <AlbumBadge title={album.title} added={albumInMusic(album) === "all"} albumId={album.id} /> : null}
      </div>
      <Link href={`/music/album/${album.id}`} className="card-link">
        <div className="card-title">{album.title}</div>
        <div className="card-sub">{sub === undefined ? album.artist : (sub ?? " ")}</div>
      </Link>
    </div>
  );
}

/**
 * A song with its album's cover, title, "Artist, Album" and length. With `onPlay` the row plays it,
 * otherwise it opens the album; `toggle` adds the + / check.
 */
export function SongRow({
  track,
  sub,
  toggle,
  onPlay,
  menuExtra,
}: {
  track: TrackDto;
  sub?: string;
  toggle?: boolean;
  onPlay?: () => void;
  /** More items for the song's ⋯ menu, such as removing it from a playlist. */
  menuExtra?: (close: () => void) => React.ReactNode;
}) {
  const { isCurrent } = usePlayer();
  const body = (
    <>
      <Cover src={albumCover(track.albumId, track.coverHash)} color={null} title={track.album} className="thumb" />
      <span className="list-row-main">
        <span className="list-row-title">{track.title}</span>
        <span className="list-row-sub">{sub ?? songSub(track)}</span>
      </span>
    </>
  );
  return (
    <div className={`list-row${isCurrent("track", track.id) ? " playing" : ""}`}>
      {onPlay ? (
        <button type="button" className="list-row-play" onClick={onPlay}>
          {body}
        </button>
      ) : (
        <Link href={`/music/album/${track.albumId}`} className="list-row-link">
          {body}
        </Link>
      )}
      <span className="muted small">{songLength(track)}</span>
      {toggle ? <MineToggle title={track.title} added={track.inMusic} change={{ trackIds: [track.id] }} /> : null}
      <SongMenuButton track={track} extra={menuExtra} />
    </div>
  );
}

/** An album as a list row, for search results, with its + / check. */
function AlbumRow({ album }: { album: AlbumSummary }) {
  return (
    <div className="list-row">
      <Link href={`/music/album/${album.id}`} className="list-row-link">
        <Cover src={albumCover(album.id, album.coverHash)} color={album.coverColor} title={album.title} className="thumb" />
        <span className="list-row-main">
          <span className="list-row-title">{album.title}</span>
          <span className="list-row-sub">{`Album, ${album.artist}`}</span>
        </span>
      </Link>
      <MineToggle title={album.title} added={albumInMusic(album) === "all"} change={{ albumIds: [album.id] }} />
    </div>
  );
}

/** The way into Browse, above the chips. */
function BrowseRow({ summary }: { summary: MusicSummaryDto }) {
  const notAdded = summary.albums - summary.mine.albums;
  return (
    <Link href="/music/browse" className="browse-row">
      <span className="browse-row-icon">
        <FolderIcon />
      </span>
      <span className="list-row-main">
        <span className="list-row-title">Browse</span>
        <span className="list-row-sub">{notAdded > 0 ? `${plural(notAdded, "album")} you haven't added` : "Everything's in your music"}</span>
      </span>
      {summary.newAlbums > 0 ? <span className="new-pill">{summary.newAlbums} new</span> : null}
      <ChevronIcon size={20} />
    </Link>
  );
}

/** First visit: nothing added yet. */
function EmptyMusic({ total }: { total: number }) {
  const send = useMineChange();
  const [busy, setBusy] = useState(false);
  const addAll = async () => {
    setBusy(true);
    try {
      const all = await api<AlbumSummary[]>(apiPaths.albums("all"));
      await send(true, { albumIds: all.map((a) => a.id) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="music-empty">
      <span className="music-empty-icon">
        <MusicIcon size={34} />
      </span>
      <h2>Pick the music you want</h2>
      <p>Add the albums and songs you like and they show up here. The rest stays out of the way.</p>
      <Link href="/music/browse" className="btn btn-primary btn-big">
        Browse
      </Link>
      <button type="button" className="btn btn-big" disabled={busy} onClick={addAll}>
        {busy ? "Adding…" : `Add all ${plural(total, "album")}`}
      </button>
    </div>
  );
}

/** Search on the Music tab also looks through everything not in your music yet. */
function MoreToAdd({ q }: { q: string }) {
  const [albums, setAlbums] = useState<AlbumSummary[] | null>(null);
  const [songs, setSongs] = useState<TrackDto[]>([]);
  useEffect(() => {
    api<AlbumSummary[]>(apiPaths.albums("all")).then(setAlbums, () => setAlbums([]));
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      api<TrackDto[]>(apiPaths.tracks("all", q)).then(setSongs, () => setSongs([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);
  const moreAlbums = (albums ?? []).filter((a) => albumInMusic(a) !== "all" && albumMatches(a, q)).slice(0, 6);
  // Songs by title only: their album and artist already show above.
  const moreSongs = songs.filter((t) => !t.inMusic && t.title.toLowerCase().includes(q)).slice(0, 20);
  if (!moreAlbums.length && !moreSongs.length) return null;
  return (
    <section className="section">
      <h2 className="section-title">More to add</h2>
      <div className="list">
        {moreAlbums.map((a) => (
          <AlbumRow key={a.id} album={a} />
        ))}
        {moreSongs.map((t) => (
          <SongRow key={t.id} track={t} sub={`Song, ${t.artist}`} toggle />
        ))}
      </div>
    </section>
  );
}

/** The Music tab: your music as albums, artists or songs, with Browse above. */
export function MusicView({
  summary,
  albums,
  artists,
  playlists,
  tab: initialTab,
}: {
  summary: MusicSummaryDto;
  albums: AlbumSummary[];
  artists: ArtistSummary[];
  playlists: PlaylistSummary[];
  tab: MusicTab;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const player = usePlayer();
  const [tab, setTab] = useState<MusicTab>(initialTab);
  const [sort, setSort] = useAlbumSort();
  const [sortOpen, setSortOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState<TrackDto[] | null>(null);
  const q = query.trim().toLowerCase();

  // Songs load the first time they're shown, and again when your music changes.
  useEffect(() => {
    if (tab !== "songs") return;
    api<TrackDto[]>(apiPaths.tracks("mine")).then(setSongs, () => setSongs([]));
  }, [tab, summary.mine.tracks]);

  const switchTab = (next: MusicTab) => {
    setTab(next);
    window.history.replaceState(null, "", next === "albums" ? pathname : `${pathname}?tab=${next}`);
  };

  const sorted = useMemo(() => sortAlbums(albums, sort), [albums, sort]);
  const byArtist = useMemo(() => albumsByArtist(albums), [albums]);

  if (summary.mine.tracks === 0 && playlists.length === 0) {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">Music</h1>
        </div>
        <BrowseRow summary={summary} />
        <EmptyMusic total={summary.albums} />
      </>
    );
  }

  const shownAlbums = sorted.filter((a) => albumMatches(a, q));
  const shownArtists = artists.filter((a) => artistMatches(a, q));
  const shownSongs = (songs ?? []).filter((t) => songMatches(t, q));
  const shownPlaylists = playlists.filter((p) => p.name.toLowerCase().includes(q));
  const songsSource: MusicSource = { kind: "songs", refId: null, title: "Your songs", tracks: shownSongs };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Music</h1>
        <div className="head-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label={searching ? "Close search" : "Search"}
            onClick={() => {
              setSearching((s) => !s);
              setQuery("");
            }}
          >
            {searching ? <CloseIcon /> : <SearchIcon />}
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
            placeholder={TABS.find((t) => t.id === tab)!.placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search music"
            autoFocus
          />
        </div>
      ) : (
        <BrowseRow summary={summary} />
      )}

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
                <AlbumCard key={a.id} album={a} sub={albumInMusic(a) === "some" ? albumInMusicLabel(a) : undefined} />
              ))}
            </div>
          ) : (
            <div className="empty">{`Nothing in your music matches "${query.trim()}".`}</div>
          )
        ) : tab === "artists" ? (
          shownArtists.length ? (
            shownArtists.map((a) => (
              // Like the Books tab's authors: the name opens the artist, then a row of their albums.
              <GroupGrid key={a.id} title={a.name} noun="album" count={a.albumCount} onOpen={() => router.push(`/music/artist/${a.id}`)}>
                {(byArtist.get(a.id) ?? []).map((al) => (
                  <AlbumCard key={al.id} album={al} sub={al.year} />
                ))}
              </GroupGrid>
            ))
          ) : (
            <div className="empty">{`No artist in your music matches "${query.trim()}".`}</div>
          )
        ) : tab === "playlists" ? (
          <>
            {q ? null : <NewPlaylistButton />}
            {shownPlaylists.length ? (
              <div className="grid" style={{ marginTop: 16 }}>
                {shownPlaylists.map((p) => (
                  <PlaylistCard key={p.id} playlist={p} />
                ))}
              </div>
            ) : (
              <div className="empty">{q ? `No playlist matches "${query.trim()}".` : "Make a playlist, then add songs from the menu on any song, with Add to playlist."}</div>
            )}
          </>
        ) : songs === null ? (
          <div className="empty">Loading songs…</div>
        ) : shownSongs.length ? (
          <>
            <div className="songs-actions">
              <button type="button" className="btn btn-primary" onClick={() => player.playMusic(songsSource, 0)}>
                <PlayIcon size={18} />
                Play all
              </button>
              <button type="button" className="btn" onClick={() => player.playMusic(songsSource, -1, true)}>
                <ShuffleIcon size={18} />
                Shuffle
              </button>
            </div>
            <div className="list">
              {shownSongs.map((t, i) => (
                <SongRow key={t.id} track={t} onPlay={() => player.playMusic(songsSource, i)} />
              ))}
            </div>
          </>
        ) : (
          <div className="empty">{`No song in your music matches "${query.trim()}".`}</div>
        )}
        {q ? <MoreToAdd q={q} /> : null}
      </div>

      <AlbumSortSheet open={sortOpen} onClose={() => setSortOpen(false)} sort={sort} onPick={setSort} />
    </>
  );
}
