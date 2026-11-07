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
  albumsByArtist,
  apiPaths,
  type ArtistSummary,
  artistImage,
  type MusicHomeDto,
  type MusicSummaryDto,
  type PlaylistSummary,
  plural,
  songLength,
  songSub,
  sortAlbums,
  type TrackDto,
} from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { Mixer } from "../mixer";
import { ChevronIcon, FilterIcon, FolderIcon, MusicIcon, PauseIcon, PlayIcon, ProfileIcon } from "../icons";
import { ShuffleButton } from "./shuffle-button";
import { type MusicSource, useNowPlaying, usePlayerControls, usePlayerSelect } from "../player/engine";
import { GroupGrid } from "../library/library";
import { ChoiceSheet } from "../sheet";
import { SongRowsSkeleton } from "../skeletons";
import { Chip, Chips, EmptyState, ScrollRow, SectionTitle, useSavedChoice } from "../ui";
import { AlbumCardMenu } from "./album-menu";
import { AlbumBadge, MineToggle, useMineChange } from "./mine";
import { NewPlaylistButton, PlaylistCard } from "./playlist-view";
import { SongMenuButton } from "./song-menu";

export type MusicTab = "home" | "albums" | "artists" | "songs" | "playlists";
const TABS: Array<{ id: MusicTab; label: string }> = [
  { id: "home", label: "Home" },
  { id: "playlists", label: "Playlists" },
  { id: "albums", label: "Albums" },
  { id: "artists", label: "Artists" },
  { id: "songs", label: "Songs" },
];
const SORT_KEY = "murmur.albumSort";

/** The album sort, kept in this browser and shared by the Music tab and Browse. */
export const useAlbumSort = () => useSavedChoice<AlbumSort>(SORT_KEY, "added", ALBUM_SORTS);

export function AlbumSortSheet({ open, onClose, sort, onPick }: { open: boolean; onClose: () => void; sort: AlbumSort; onPick: (s: AlbumSort) => void }) {
  return <ChoiceSheet open={open} onClose={onClose} title="Sort albums" choices={ALBUM_SORTS} value={sort} onPick={onPick} />;
}

/** Cover with title and a sub line; `badge` puts the add / added button on the cover. */
export function AlbumCard({ album, sub, badge }: { album: AlbumSummary; sub?: string | null; badge?: boolean }) {
  // Any of its songs, from the album itself or from a playlist or Up Next.
  const current = usePlayerSelect((s) => s.item?.type === "track" && s.item.album?.id === album.id);
  const playing = usePlayerSelect((s) => current && s.playing);
  return (
    <div className={`card${current ? " playing" : ""}`}>
      <div className="card-cover">
        <Link href={`/music/album/${album.id}`} aria-label={`${album.title}, ${album.artist}`} tabIndex={-1}>
          <Cover src={albumCover(album.id, album.coverHash)} color={album.coverColor} title={album.title} subtitle={album.artist} />
        </Link>
        {current ? <Mixer playing={playing} /> : null}
        {badge ? <AlbumBadge title={album.title} added={albumInMusic(album) === "all"} albumId={album.id} /> : null}
      </div>
      <AlbumCardMenu album={album} />
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
  const { current, playing } = useNowPlaying((n) => n.type === "track" && n.id === track.id);
  const body = (
    <>
      <span className="thumb-wrap">
        <Cover src={albumCover(track.albumId, track.coverHash)} color={null} title={track.album} className="thumb" />
        {current ? <Mixer playing={playing} thumb /> : null}
      </span>
      <span className="list-row-main">
        <span className="list-row-title">{track.title}</span>
        <span className="list-row-sub">{sub ?? songSub(track)}</span>
      </span>
    </>
  );
  return (
    <div className={`list-row${current ? " playing" : ""}`}>
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

/** No music folder set up yet. */
function NoMusic({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="music-empty">
      <span className="music-empty-icon">
        <MusicIcon size={34} />
      </span>
      <h2>No music yet</h2>
      <p>{isAdmin ? "Mount your music at /music, and your albums show up here." : "Albums show up here once they're added."}</p>
    </div>
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
        {busy ? "Adding…" : total === 1 ? "Add the album" : `Add all ${plural(total, "album")}`}
      </button>
    </div>
  );
}

/** How many On repeat songs Home lists. */
const ON_REPEAT_ROWS = 5;

/** A round artist photo (else one of their covers, else a person icon) with the name and album count under it; opens the artist. */
export function ArtistCard({ artist }: { artist: ArtistSummary }) {
  const src = artistImage(artist);
  return (
    <Link href={`/music/artist/${artist.id}`} className="card card-link artist-card">
      {src ? (
        <Cover src={src} color={null} title={artist.name} />
      ) : (
        <span className="cover artist-card-empty" aria-hidden="true">
          <ProfileIcon size={40} />
        </span>
      )}
      <div className="card-title">{artist.name}</div>
      <div className="card-sub">{plural(artist.albumCount, "album")}</div>
    </Link>
  );
}

/** The Home chip: Jump back in, On repeat, More like the last album and its artist, and New albums. A shelf with nothing to show is left out. */
function MusicHome({ home }: { home: MusicHomeDto }) {
  const player = usePlayerControls();
  // Five rows show; picking one queues all of them (up to 25) from that song on.
  const onRepeat = home.onRepeat.slice(0, ON_REPEAT_ROWS);
  const onRepeatSource: MusicSource = { kind: "songs", refId: null, title: "On repeat", tracks: home.onRepeat };
  const likeAlbum = home.moreLikeAlbum?.items.length ? home.moreLikeAlbum : null;
  const likeArtist = home.moreLikeArtist?.items.length ? home.moreLikeArtist : null;
  if (!home.jumpBackIn.length && !onRepeat.length && !likeAlbum && !likeArtist && !home.newAlbums.length) {
    return <EmptyState>Play something and it shows up here.</EmptyState>;
  }
  return (
    <>
      {home.jumpBackIn.length ? (
        <section className="section" style={{ marginTop: 0 }}>
          <SectionTitle title="Jump back in" />
          <ScrollRow>
            {home.jumpBackIn.map((i) =>
              i.kind === "album" ? <AlbumCard key={`a-${i.album.id}`} album={i.album} /> : <PlaylistCard key={`p-${i.playlist.id}`} playlist={i.playlist} />,
            )}
          </ScrollRow>
        </section>
      ) : null}
      {onRepeat.length ? (
        <section className="section">
          <SectionTitle title="On repeat" />
          <div className="list">
            {onRepeat.map((t, i) => (
              <SongRow key={t.id} track={t} onPlay={() => player.playMusic(onRepeatSource, i)} />
            ))}
          </div>
        </section>
      ) : null}
      {likeAlbum ? (
        <section className="section">
          <SectionTitle title={likeAlbum.title} />
          <ScrollRow>
            {likeAlbum.items.map((a) => (
              <AlbumCard key={a.id} album={a} badge />
            ))}
          </ScrollRow>
        </section>
      ) : null}
      {likeArtist ? (
        <section className="section">
          <SectionTitle title={likeArtist.title} />
          <ScrollRow>
            {likeArtist.items.map((a) => (
              <ArtistCard key={a.id} artist={a} />
            ))}
          </ScrollRow>
        </section>
      ) : null}
      {home.newAlbums.length ? (
        <section className="section">
          <SectionTitle title="New albums" />
          <ScrollRow>
            {home.newAlbums.map((a) => (
              <AlbumCard key={a.id} album={a} badge />
            ))}
          </ScrollRow>
        </section>
      ) : null}
    </>
  );
}

/** The Music tab: Home's shelves, then your music as albums, artists or songs, with Browse above. */
export function MusicView({
  summary,
  home,
  albums,
  artists,
  playlists,
  tab: initialTab,
  isAdmin,
}: {
  summary: MusicSummaryDto;
  home: MusicHomeDto;
  albums: AlbumSummary[];
  artists: ArtistSummary[];
  playlists: PlaylistSummary[];
  tab: MusicTab;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const player = usePlayerControls();
  const [tab, setTab] = useState<MusicTab>(initialTab);
  const [sort, setSort] = useAlbumSort();
  const [sortOpen, setSortOpen] = useState(false);
  const [songs, setSongs] = useState<TrackDto[] | null>(null);

  // Songs load the first time they're shown, and again when your music changes.
  useEffect(() => {
    if (tab !== "songs") return;
    api<TrackDto[]>(apiPaths.tracks("mine")).then(setSongs, () => setSongs([]));
  }, [tab, summary.mine.tracks]);

  const switchTab = (next: MusicTab) => {
    setTab(next);
    window.history.replaceState(null, "", next === "home" ? pathname : `${pathname}?tab=${next}`);
  };

  const sorted = useMemo(() => sortAlbums(albums, sort), [albums, sort]);
  const byArtist = useMemo(() => albumsByArtist(albums), [albums]);
  const songsFrom = usePlayerSelect((s) => s.isPlayingFrom("songs", null));
  const songsPlaying = usePlayerSelect((s) => songsFrom && s.playing);

  if (!summary.enabled || (summary.mine.tracks === 0 && playlists.length === 0)) {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">Music</h1>
        </div>
        {summary.enabled ? (
          <>
            <BrowseRow summary={summary} />
            <EmptyMusic total={summary.albums} />
          </>
        ) : (
          <NoMusic isAdmin={isAdmin} />
        )}
      </>
    );
  }

  const songsSource: MusicSource = { kind: "songs", refId: null, title: "Your songs", tracks: songs ?? [] };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Music</h1>
        <div className="head-actions">
          {tab === "albums" ? (
            <button type="button" className="icon-btn" aria-label={`Sort albums, ${ALBUM_SORTS.find((s) => s.id === sort)?.label}`} onClick={() => setSortOpen(true)}>
              <FilterIcon />
            </button>
          ) : null}
        </div>
      </div>

      <BrowseRow summary={summary} />

      <Chips kind="tabs" label="Music view">
        {TABS.map((t) => (
          <Chip key={t.id} selected={tab === t.id} onClick={() => switchTab(t.id)}>
            {t.label}
          </Chip>
        ))}
      </Chips>

      <div key={tab} className="view-fade" style={{ marginTop: 16 }}>
        {tab === "home" ? (
          <MusicHome home={home} />
        ) : tab === "albums" ? (
          <div className="grid">
            {sorted.map((a) => (
              <AlbumCard key={a.id} album={a} sub={albumInMusic(a) === "some" ? albumInMusicLabel(a) : undefined} />
            ))}
          </div>
        ) : tab === "artists" ? (
          artists.length ? (
            artists.map((a) => (
              // Like the Books tab's authors: the name opens the artist, then a row of their albums.
              <GroupGrid key={a.id} title={a.name} noun="album" count={a.albumCount} onOpen={() => router.push(`/music/artist/${a.id}`)}>
                {(byArtist.get(a.id) ?? []).map((al) => (
                  <AlbumCard key={al.id} album={al} sub={al.year} />
                ))}
              </GroupGrid>
            ))
          ) : (
            <EmptyState>Nothing here yet.</EmptyState>
          )
        ) : tab === "playlists" ? (
          <>
            {/* New playlist is the first tile. */}
            <div className="grid">
              <NewPlaylistButton />
              {playlists.map((p) => (
                <PlaylistCard key={p.id} playlist={p} />
              ))}
            </div>
            {playlists.length ? null : <EmptyState>Make a playlist, then add songs to it from the menu on any song.</EmptyState>}
          </>
        ) : songs === null ? (
          <SongRowsSkeleton />
        ) : songs.length ? (
          <>
            <div className="songs-actions">
              <button type="button" className="btn btn-primary" onClick={() => (songsFrom ? player.toggle() : player.playMusic(songsSource, -1))}>
                {songsPlaying ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                {songsFrom ? (songsPlaying ? "Pause" : "Resume") : "Play all"}
              </button>
              <ShuffleButton source={songsSource} size={20} />
            </div>
            <div className="list">
              {songs.map((t, i) => (
                <SongRow key={t.id} track={t} onPlay={() => player.playMusic(songsSource, i)} />
              ))}
            </div>
          </>
        ) : (
          <EmptyState>Nothing here yet.</EmptyState>
        )}
      </div>

      <AlbumSortSheet open={sortOpen} onClose={() => setSortOpen(false)} sort={sort} onPick={setSort} />
    </>
  );
}
