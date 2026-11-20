import { memo, useState } from "react";
import { Pressable, type StyleProp, View, type ViewStyle } from "react-native";
import { router } from "expo-router";
import {
  ALBUM_SORTS,
  albumCover,
  type AlbumSort,
  type AlbumSummary,
  artistImage,
  type ArtistSummary,
  guestArtist,
  plural,
  type UpNextSource,
  songLength,
  songSub,
  storageKeys,
  type TrackDto,
} from "@murmur/shared/client";
import { setLiked, useAlbum } from "@/lib/data";
import { selectHaptic, withLongPressHaptic } from "@/lib/haptics";
import { downloadTrack, removeDownload, useDownload, useInAlbumDownload } from "@/lib/downloads";
import { useIsAdmin } from "@/lib/session";
import { createSavedStore } from "@/lib/store";
import { addToUpNext, playMusic, isCurrent, isPlayingFrom, isWaiting, removeWaiting, toggle, toggleShuffle, usePlayerSelect } from "@/player/engine";
import { fonts, useTheme } from "@/theme";
import { Cover } from "./cover";
import { DragIcon, HeartIcon, MoreIcon, PauseIcon, PlayIcon, ProfileIcon, ShuffleIcon } from "./icons";
import { AlbumMatchSheet } from "./match";
import { Mixer, MixerBars, useNowPlaying } from "./mixer";
import { AddToPlaylistSheet } from "./playlists";
import { HideItem, Sheet, SheetDivider, SheetItem, useCardMenu, useMenuIdle } from "./sheet";
import { DragHandle } from "./sortable-list";
import { toast } from "./toast";
import { ACTION_HEIGHT, IconButton, Text } from "./ui";

// Shared by the Music tab, Album and Artist screens. The text helpers (songSub, albumPills and so
// on) live in @murmur/shared, so the web and the app say the same thing.

const openAlbum =(id: string) => router.push(`/album/${id}`);

/** An album's or playlist's songs into Up Next in order, to play next. */
export const addSongsToUpNext = (tracks: TrackDto[]) =>
  addToUpNext(
    tracks.map((tr) => ({ itemType: "track", itemId: tr.id })),
    "next",
  ).then(
    () => toast.show("Added to queue"),
    (err: unknown) => toast.error(err instanceof Error ? err.message : "Couldn't do that."),
  );
export const openArtist = (id: string) => router.push(`/artist/${id}`);

/**
 * An album's menu, the same from a card's long press and the album page's ⋯ (like the web's):
 * play, Up Next, playlist and artist, then for admins Match.
 */
export function AlbumActions({
  album,
  open,
  onClose,
  onIdle,
  onHidden,
}: {
  album: AlbumSummary;
  open: boolean;
  onClose: () => void;
  onIdle?: () => void;
  /** On the album's own page: goes back once it's hidden. */
  onHidden?: () => void;
}) {
  const admin = useIsAdmin();
  // The songs, for playing and adding; already cached on the album page.
  const tracks = useAlbum(album.id).data?.tracks;
  const [adding, setAdding] = useState(false);
  const [matching, setMatching] = useState(false);
  useMenuIdle(open || adding || matching, onIdle);
  const then = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title={album.title}>
        <SheetItem
          label="Play"
          disabled={!tracks}
          onPress={then(() => {
            if (!tracks) return;
            playMusic({ kind: "album", refId: album.id, title: album.title, tracks }, -1);
            router.push("/player");
          })}
        />
        <SheetItem label="Add to queue" disabled={!tracks} onPress={then(() => tracks && void addSongsToUpNext(tracks))} />
        <SheetItem label="Add to playlist…" disabled={!tracks} onPress={then(() => setAdding(true))} />
        <SheetItem label={`Go to ${album.artist}`} onPress={then(() => openArtist(album.artistId))} />
        {admin ? (
          <>
            <SheetDivider />
            <SheetItem label="Match…" onPress={then(() => setMatching(true))} />
          </>
        ) : null}
        <HideItem kind="album" id={album.id} title={album.title} onClose={onClose} onHidden={onHidden} />
      </Sheet>
      <AddToPlaylistSheet open={adding} onClose={() => setAdding(false)} title={album.title} trackIds={tracks?.map((tr) => tr.id) ?? []} />
      {admin ? <AlbumMatchSheet album={matching ? album : null} onClose={() => setMatching(false)} /> : null}
    </>
  );
}

// ---------- Album sort, kept on this phone ----------

const albumSort = createSavedStore<AlbumSort>(storageKeys.albumSort, "added");

const setAlbumSort = albumSort.set;

export const useAlbumSort = albumSort.useValue;

/** The album sort, for code outside React (Android Auto). */
export const getAlbumSort = albumSort.get;

export function AlbumSortSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sort = useAlbumSort();
  return (
    <Sheet open={open} onClose={onClose} title="Sort albums">
      {ALBUM_SORTS.map((s) => (
        <SheetItem
          key={s.id}
          label={s.label}
          active={sort === s.id}
          onPress={() => {
            setAlbumSort(s.id);
            onClose();
          }}
        />
      ))}
    </Sheet>
  );
}

// ---------- Cards and rows ----------

/** Cover with the title and artist under it, for album grids. */
export const AlbumCard = memo(function AlbumCard({ album, width, sub }: { album: AlbumSummary; width: number; sub?: string | null }) {
  const t = useTheme();
  // From the album itself, a playlist or Up Next: any song of this album playing counts.
  const now = useNowPlaying((s) => s.item?.type === "track" && s.item.album?.id === album.id);
  const menu = useCardMenu();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${album.title}, ${album.artist}`}
      accessibilityActions={[{ name: "longpress", label: "Options" }]}
      onAccessibilityAction={menu.show}
      onPress={() => openAlbum(album.id)}
      onLongPress={withLongPressHaptic(menu.show)}
      style={({ pressed }) => ({ width, gap: 8, opacity: pressed ? 0.75 : 1 })}
    >
      {menu.shown ? <AlbumActions album={album} open={menu.open} onClose={menu.close} onIdle={menu.idle} /> : null}
      <View>
        <Cover path={albumCover(album.id, album.coverHash, 600)} title={album.title} color={album.coverColor} />
        {now ? <Mixer playing={now === "playing"} /> : null}
      </View>
      <View style={{ gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14, color: now ? t.accent : t.text }}>
          {album.title}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {sub === undefined ? album.artist : (sub ?? " ")}
        </Text>
      </View>
    </Pressable>
  );
});

/** An artist on a shelf: their round photo (or an album cover of theirs), the name and how many albums, centred. */
export const ArtistCard = memo(function ArtistCard({ artist, width }: { artist: ArtistSummary; width: number }) {
  const t = useTheme();
  const photo = artistImage(artist);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${artist.name}, ${plural(artist.albumCount, "album")}`}
      onPress={() => openArtist(artist.id)}
      style={({ pressed }) => ({ width, gap: 8, opacity: pressed ? 0.75 : 1 })}
    >
      {photo ? (
        <Cover path={photo} title={artist.name} size={width} radius={width / 2} />
      ) : (
        <View style={{ width, height: width, borderRadius: width / 2, backgroundColor: t.surface, alignItems: "center", justifyContent: "center" }}>
          <ProfileIcon size={40} color={t.muted} />
        </View>
      )}
      <View style={{ gap: 2, alignItems: "center" }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14 }}>
          {artist.name}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {plural(artist.albumCount, "album")}
        </Text>
      </View>
    </Pressable>
  );
});

/** Play, Shuffle and the like over a list of songs. Without `onPress` it's drawn but disabled. */
export function ActionButton({
  label,
  icon,
  primary,
  round,
  selected,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  primary?: boolean;
  round?: boolean;
  /** For a button that stays on, like Shuffle. */
  selected?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !onPress, selected }}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: round ? undefined : 1,
        width: round ? ACTION_HEIGHT : undefined,
        height: ACTION_HEIGHT,
        borderRadius: ACTION_HEIGHT / 2,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        backgroundColor: primary ? t.accent : t.surface2,
        opacity: !onPress ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {icon}
      {round ? null : <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: primary ? t.onAccent : t.text }}>{label}</Text>}
    </Pressable>
  );
}

/**
 * A song's ⋯ menu (also a long press): add it to Up Next (or take it out while it's still to come),
 * add it to a playlist, go to its album, download it on its own (or remove that copy), then any
 * `extra` items.
 */
export function SongSheet({
  track,
  onClose,
  hideAlbum,
  extra,
}: {
  track: TrackDto | null;
  onClose: () => void;
  /** On the album's own page, where "Go to album" goes nowhere. */
  hideAlbum?: boolean;
  /** More items at the end, given the song and a function that closes the menu. */
  extra?: (track: TrackDto, close: () => void) => React.ReactNode;
}) {
  // Kept after the menu closes, so the playlist picker can slide up in its place.
  const [adding, setAdding] = useState<TrackDto | null>(null);
  return (
    <>
      <Sheet open={track !== null} onClose={onClose} title={track?.title}>
        {track ? (
          <SongSheetItems
            track={track}
            onClose={onClose}
            hideAlbum={hideAlbum}
            onAddToPlaylist={() => {
              setAdding(track);
              onClose();
            }}
          />
        ) : null}
        {track ? extra?.(track, onClose) : null}
      </Sheet>
      <AddToPlaylistSheet open={adding !== null} onClose={() => setAdding(null)} title={adding?.title ?? ""} trackIds={adding ? [adding.id] : []} />
    </>
  );
}

function SongSheetItems({ track, onClose, hideAlbum, onAddToPlaylist }: { track: TrackDto; onClose: () => void; hideAlbum?: boolean; onAddToPlaylist: () => void }) {
  const own = useDownload("track", track.id);
  const withAlbum = useInAlbumDownload(track);
  const close = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const run = (fn: () => Promise<void>, done: string) =>
    close(() =>
      fn().then(
        () => toast.show(done),
        (err: unknown) => toast.error(err instanceof Error ? err.message : "Couldn't do that."),
      ),
    );
  const ref = { itemType: "track" as const, itemId: track.id };
  const queued = usePlayerSelect((s) => isWaiting(s.upNext, ref));
  return (
    <>
      {queued ? (
        <SheetItem label="Remove from queue" onPress={run(async () => removeWaiting(ref), "Removed from queue")} />
      ) : (
        <SheetItem label="Add to queue" onPress={run(() => addToUpNext(ref, "next"), "Added to queue")} />
      )}
      <SheetItem label="Add to playlist…" onPress={onAddToPlaylist} />
      {hideAlbum ? null : <SheetItem label="Go to album" onPress={close(() => openAlbum(track.albumId))} />}
      {own ? (
        <SheetItem
          label={own.status === "downloading" ? `Cancel download, ${own.waiting ? "waiting" : `${Math.round(own.progress * 100)}%`}` : "Remove download"}
          danger={own.status !== "downloading"}
          onPress={close(() => removeDownload("track", track.id))}
        />
      ) : withAlbum ? (
        <SheetItem label="Downloaded with the album" disabled onPress={onClose} />
      ) : (
        <SheetItem label="Download song" onPress={close(() => downloadTrack(track))} />
      )}
    </>
  );
}

/** "playing" or "paused" while this song is the one loaded, else null; only that row renders again. */
const usePlayingSong = (id: string) => useNowPlaying((s) => isCurrent(s, "track", id));

/**
 * A song with its album's cover, title, "Artist, Album", length and heart. With `onPlay` a tap
 * plays it, otherwise it opens its album.
 */
export const SongRow = memo(function SongRow({
  track,
  onPlay,
  onMore,
  sortable,
}: {
  track: TrackDto;
  /** Called with the row's song, so a long list can pass one function to every row and keep the memo. */
  onPlay?: (track: TrackDto) => void;
  /** The ⋯ button and a long press: the song's menu. */
  onMore?: (track: TrackDto) => void;
  /** A row in a SortableList (a playlist): a drag handle at the end, and no line under it. */
  sortable?: boolean;
}) {
  const t = useTheme();
  const playing = usePlayingSong(track.id);
  const more = onMore ? () => onMore(track) : undefined;
  const press = {
    accessibilityRole: "button",
    accessibilityHint: onPlay ? "Plays this song" : "Opens its album",
    onPress: onPlay ? () => onPlay(track) : () => openAlbum(track.albumId),
    onLongPress: withLongPressHaptic(more),
  } as const;
  const body = (
    <>
      <View>
        <Cover path={albumCover(track.albumId, track.coverHash)} title="" size={44} radius={6} />
        {playing ? <Mixer thumb radius={6} playing={playing === "playing"} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 15, color: playing ? t.accent : t.text }}>
          {track.title}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {songSub(track)}
        </Text>
      </View>
      <Length track={track} />
    </>
  );
  // The handle sits outside the pressable part, so a drag never reads as a tap or a long press.
  if (sortable) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 64, paddingHorizontal: 8 }}>
        <Pressable {...press} style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.7 : 1 })}>
          {body}
        </Pressable>
        <SongLike track={track} />
        {more ? <SongMoreButton track={track} onPress={more} /> : null}
        <DragHandle label={`Drag to reorder ${track.title}`}>
          <DragIcon size={20} color={t.muted} />
        </DragHandle>
      </View>
    );
  }
  return (
    <Pressable
      {...press}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, borderBottomWidth: 1, borderBottomColor: t.line, opacity: pressed ? 0.7 : 1 })}
    >
      {body}
      <SongLike track={track} />
      {more ? <SongMoreButton track={track} onPress={more} last /> : null}
    </Pressable>
  );
});

function SongMoreButton({ track, onPress, last }: { track: TrackDto; onPress: () => void; last?: boolean }) {
  const t = useTheme();
  return (
    <IconButton label={`More for ${track.title}`} onPress={onPress} style={{ width: 36, marginLeft: -6, marginRight: last ? -8 : 0 }}>
      <MoreIcon size={20} color={t.muted} />
    </IconButton>
  );
}

/** A numbered song on an album: number, title (and its own artist when it differs), length, heart. */
export function TrackRow({
  track,
  n,
  albumArtistId,
  onPlay,
  onMore,
}: {
  track: TrackDto;
  n: number;
  albumArtistId: string;
  onPlay?: () => void;
  /** The ⋯ button and a long press: the song's menu. */
  onMore?: () => void;
}) {
  const t = useTheme();
  const guest = guestArtist(track, albumArtistId);
  const playing = usePlayingSong(track.id);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, borderBottomWidth: 1, borderBottomColor: t.line }}>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Plays the album from this song. Long press for more options"
        disabled={!onPlay}
        onPress={onPlay}
        onLongPress={withLongPressHaptic(onMore)}
        style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.7 : 1 })}
      >
        {/* A 28 wide slot, centred, in the title's size, so numbers line up with the titles. */}
        {playing ? (
          <View style={{ width: 28, alignItems: "center" }}>
            <MixerBars playing={playing === "playing"} color={t.accent} />
          </View>
        ) : (
          <Text
            style={{
              width: 28,
              textAlign: "center",
              fontFamily: fonts.medium,
              fontSize: 15,
              lineHeight: 15,
              includeFontPadding: false,
              color: t.muted,
              fontVariant: ["tabular-nums"],
            }}
          >
            {n}
          </Text>
        )}
        <View style={{ flex: 1, gap: 2, paddingVertical: 8 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 15, color: playing ? t.accent : t.text }}>
            {track.title}
          </Text>
          {guest ? (
            <Text variant="small" numberOfLines={1}>
              {guest}
            </Text>
          ) : null}
        </View>
        <Length track={track} />
      </Pressable>
      <SongLike track={track} />
      {onMore ? <SongMoreButton track={track} onPress={onMore} last /> : null}
    </View>
  );
}

/** A song's heart: filled in the accent once liked. */
function SongLike({ track }: { track: TrackDto }) {
  const t = useTheme();
  const on = !!track.liked;
  // A server from before likes sends none, and there's no heart.
  if (track.liked === undefined) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={on ? `Unlike ${track.title}` : `Like ${track.title}`}
      accessibilityState={{ checked: on }}
      onPress={() => {
        selectHaptic();
        void setLiked({ tracks: [track] }, !on);
      }}
      style={({ pressed }) => ({ width: 40, height: 44, marginRight: -6, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
    >
      <HeartIcon size={20} filled={on} color={on ? t.accent : t.faint} />
    </Pressable>
  );
}

/**
 * A round heart for a whole album or the song playing: filled in the accent once liked, an
 * outline otherwise.
 */
export function LikeButton({
  liked,
  label,
  onPress,
  size = 24,
  color,
  style,
}: {
  liked: boolean;
  label: string;
  onPress: () => void;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <IconButton
      label={liked ? `Unlike ${label}` : `Like ${label}`}
      accessibilityState={{ checked: liked }}
      style={style}
      onPress={() => {
        selectHaptic();
        onPress();
      }}
    >
      <HeartIcon size={size} filled={liked} color={liked ? t.accent : (color ?? t.text)} />
    </IconButton>
  );
}

function Length({ track }: { track: TrackDto }) {
  const t = useTheme();
  return <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: t.muted, fontVariant: ["tabular-nums"] }}>{songLength(track)}</Text>;
}

/** Where the songs on a screen play from: an album, a playlist, or Songs (refId null). */
type MusicRef = { kind: UpNextSource["kind"]; refId: string | null };

/**
 * Play for an album, list or Songs. While music from that same place is loaded, it pauses and
 * resumes instead of starting over, as the Play button on a book does.
 */
export function PlayButton({
  label = "Play",
  from,
  round,
  opensPlayer,
  onPress,
}: {
  label?: string;
  from: MusicRef;
  round?: boolean;
  /** Starting this music opens the full player, as an album's or playlist's Play does; pausing and resuming don't. */
  opensPlayer?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const live = usePlayerSelect((s) => isPlayingFrom(s, from.kind, from.refId));
  const playing = usePlayerSelect((s) => s.playing);
  const color = round ? t.text : t.onAccent;
  if (live) {
    return (
      <ActionButton
        label={playing ? "Pause" : "Resume"}
        primary={!round}
        round={round}
        icon={playing ? <PauseIcon size={20} color={color} /> : <PlayIcon size={20} color={color} />}
        onPress={toggle}
      />
    );
  }
  const start = () => {
    onPress();
    if (opensPlayer) router.push("/player");
  };
  return <ActionButton label={label} primary={!round} round={round} icon={<PlayIcon size={20} color={color} />} onPress={start} />;
}

/**
 * The round Shuffle beside Play, lit while shuffle is on. Off, it turns shuffle on and plays (`onPlay`
 * passes shuffle); on, or while this music is already playing, it just toggles shuffle.
 */
export function ShuffleButton({ from, onPlay }: { from: MusicRef; onPlay: () => void }) {
  const t = useTheme();
  const live = usePlayerSelect((s) => isPlayingFrom(s, from.kind, from.refId));
  const shuffle = usePlayerSelect((s) => s.shuffle);
  return (
    <ActionButton
      label="Shuffle"
      round
      primary={shuffle}
      selected={shuffle}
      icon={<ShuffleIcon size={20} color={shuffle ? t.onAccent : t.text} />}
      onPress={() => (live || shuffle ? toggleShuffle() : onPlay())}
    />
  );
}
