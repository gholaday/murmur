"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ALBUM_SORTS,
  type AlbumSort,
  type AlbumSummary,
  albumCover,
  albumsByArtist,
  type ArtistSummary,
  artistImage,
  type LikedMusicDto,
  type MusicHomeDto,
  type MusicSummaryDto,
  type PlaylistSummary,
  plural,
  sortAlbums,
  LIKED_SONGS,
  MUSIC_TABS,
  type MusicTab,
  storageKeys,
} from "@murmur/shared/client";
import { useAdmin } from "../admin";
import { Cover } from "../cover";
import { Mixer } from "../mixer";
import { FilterIcon, MusicIcon, PauseIcon, PlayIcon, ProfileIcon } from "../icons";
import { ShuffleButton } from "./shuffle-button";
import { type MusicSource, usePlayerControls, usePlayerSelect } from "../player/engine";
import { GroupGrid } from "../library/library";
import { LibraryTitle } from "../library/library-title";
import { ChoiceSheet } from "../sheet";
import { Chip, Chips, EmptyState, ScrollRow, SectionTitle, useSavedChoice } from "../ui";
import { AlbumCardMenu } from "./album-menu";
import { NewPlaylistButton, PlaylistCard } from "./playlist-view";
import { SongRow } from "./song-row";

const TABS = MUSIC_TABS;

/** The album sort, kept in this browser. */
export const useAlbumSort = () => useSavedChoice<AlbumSort>(storageKeys.albumSort, "added", ALBUM_SORTS);

/** Cover with title and a sub line. */
export function AlbumCard({ album, sub }: { album: AlbumSummary; sub?: string | null }) {
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
      </div>
      <AlbumCardMenu album={album} />
      <Link href={`/music/album/${album.id}`} className="card-link">
        <div className="card-title">{album.title}</div>
        <div className="card-sub">{sub === undefined ? album.artist : (sub ?? " ")}</div>
      </Link>
    </div>
  );
}

/** No music folder set up yet. */
function NoMusic() {
  const { isAdmin } = useAdmin();
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
              <AlbumCard key={a.id} album={a} />
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
          <SectionTitle title="New albums" count={home.newAlbums.length} noun="new album" />
          <ScrollRow>
            {home.newAlbums.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </ScrollRow>
        </section>
      ) : null}
    </>
  );
}

/** Liked albums, then liked songs with Play. */
function LikedTab({ liked }: { liked: LikedMusicDto }) {
  const player = usePlayerControls();
  const source: MusicSource = { ...LIKED_SONGS, tracks: liked.tracks };
  const from = usePlayerSelect((s) => s.isPlayingFrom(LIKED_SONGS.kind, LIKED_SONGS.refId));
  const playing = usePlayerSelect((s) => from && s.playing);
  if (!liked.albums.length && !liked.tracks.length) {
    return <EmptyState title="No likes yet">Tap the heart on any song or album to find it here.</EmptyState>;
  }
  return (
    <>
      {liked.albums.length ? (
        <section className="section" style={{ marginTop: 0 }}>
          <SectionTitle title="Albums" count={liked.albums.length} noun="album" />
          <div className="grid">
            {liked.albums.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </div>
        </section>
      ) : null}
      {liked.tracks.length ? (
        <section className="section" style={liked.albums.length ? undefined : { marginTop: 0 }}>
          <SectionTitle title="Songs" count={liked.tracks.length} noun="song" />
          <div className="songs-actions">
            <button type="button" className="btn btn-primary" onClick={() => (from ? player.toggle() : player.playMusic(source, -1))}>
              {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
              {from ? (playing ? "Pause" : "Resume") : "Play"}
            </button>
            <ShuffleButton source={source} size={20} />
          </div>
          <div className="list">
            {liked.tracks.map((t, i) => (
              <SongRow key={t.id} track={t} onPlay={() => player.playMusic(source, i)} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

/** Library's Music section: Home's shelves, what you liked, your playlists, and every album and artist. */
export function MusicView({
  summary,
  home,
  albums,
  artists,
  playlists,
  liked,
  tab: initialTab,
}: {
  summary: MusicSummaryDto;
  home: MusicHomeDto;
  albums: AlbumSummary[];
  artists: ArtistSummary[];
  playlists: PlaylistSummary[];
  liked: LikedMusicDto;
  tab: MusicTab;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [tab, setTab] = useState<MusicTab>(initialTab);
  const [sort, setSort] = useAlbumSort();
  const [sortOpen, setSortOpen] = useState(false);

  const switchTab = (next: MusicTab) => {
    setTab(next);
    window.history.replaceState(null, "", next === "home" ? pathname : `${pathname}?tab=${next}`);
  };

  const sorted = useMemo(() => sortAlbums(albums, sort), [albums, sort]);
  const byArtist = useMemo(() => albumsByArtist(albums), [albums]);

  if (!summary.enabled) {
    return (
      <>
        <div className="page-head">
          <LibraryTitle current="music" />
        </div>
        <NoMusic />
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <LibraryTitle current="music" />
        <div className="head-actions">
          {tab === "albums" ? (
            <button type="button" className="icon-btn" aria-label={`Sort albums, ${ALBUM_SORTS.find((s) => s.id === sort)?.label}`} onClick={() => setSortOpen(true)}>
              <FilterIcon />
            </button>
          ) : null}
        </div>
      </div>

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
        ) : tab === "liked" ? (
          <LikedTab liked={liked} />
        ) : tab === "albums" ? (
          <div className="grid">
            {sorted.map((a) => (
              <AlbumCard key={a.id} album={a} />
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
        ) : (
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
        )}
      </div>

      <ChoiceSheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort albums" choices={ALBUM_SORTS} value={sort} onPick={setSort} />
    </>
  );
}
