import { memo, useState, useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import {
  ALBUM_SORTS,
  albumCover,
  albumInMusic,
  type AlbumSort,
  type AlbumSummary,
  guestArtist,
  type UpNextSource,
  songLength,
  songSub,
  type TrackDto,
} from "@murmur/shared/client";
import { setInMusic, useAlbum } from "@/lib/data";
import { selectHaptic, withLongPressHaptic } from "@/lib/haptics";
import { downloadTrack, removeDownload, useDownload, useInAlbumDownload } from "@/lib/downloads";
import { useSession } from "@/lib/session";
import { getJson, setJson } from "@/lib/storage";
import { addToUpNext, playMusic, isCurrent, isPlayingFrom, isWaiting, removeWaiting, toggle, toggleShuffle, usePlayerSelect } from "@/player/engine";
import { fonts, useTheme } from "@/theme";
import { Cover } from "./cover";
import { CheckIcon, MoreIcon, PauseIcon, PlayIcon, PlusIcon, ShuffleIcon } from "./icons";
import { AlbumMatchSheet } from "./match";
import { Mixer, MixerBars, useNowPlaying } from "./mixer";
import { AddToPlaylistSheet } from "./playlists";
import { Sheet, SheetDivider, SheetItem, useCardMenu, useMenuIdle } from "./sheet";
import { toast } from "./toast";
import { IconButton, Pill, Pills, Text } from "./ui";

// Shared by the Music tab, Album and Artist screens. The text helpers (songSub, albumPills and so
// on) live in @murmur/shared, so the web and the app say the same thing.

export const openAlbum = (id: string) => router.push(`/album/${id}`);

/** An album's or playlist's songs into Up Next in order, to play next. */
export const addSongsToUpNext = (tracks: TrackDto[]) =>
  addToUpNext(
    tracks.map((tr) => ({ itemType: "track", itemId: tr.id })),
    "next",
  ).then(
    () => toast.show("Added to Up Next"),
    (err: unknown) => toast.error(err instanceof Error ? err.message : "Couldn't do that."),
  );
export const openArtist = (id: string) => router.push(`/artist/${id}`);

/**
 * An album's menu, the same from a card's long press and the album page's ⋯ (like the web's):
 * play, Up Next, playlist, artist and your music, then for admins Match.
 */
export function AlbumActions({ album, open, onClose, onIdle }: { album: AlbumSummary; open: boolean; onClose: () => void; onIdle?: () => void }) {
  const admin = !!useSession().user?.isAdmin;
  // The songs, for playing and adding; already cached on the album page.
  const tracks = useAlbum(album.id).data?.tracks;
  const [adding, setAdding] = useState(false);
  const [matching, setMatching] = useState(false);
  useMenuIdle(open || adding || matching, onIdle);
  const all = albumInMusic(album) === "all";
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
        <SheetItem label="Add to Up Next" disabled={!tracks} onPress={then(() => tracks && void addSongsToUpNext(tracks))} />
        <SheetItem label="Add to playlist…" disabled={!tracks} onPress={then(() => setAdding(true))} />
        <SheetItem label={`Go to ${album.artist}`} onPress={then(() => openArtist(album.artistId))} />
        <SheetItem
          label={all ? "Remove from your music" : "Add to your music"}
          onPress={then(() => {
            selectHaptic();
            void setInMusic({ albums: [album] }, !all);
          })}
        />
        {admin ? (
          <>
            <SheetDivider />
            <SheetItem label="Match…" onPress={then(() => setMatching(true))} />
          </>
        ) : null}
      </Sheet>
      <AddToPlaylistSheet open={adding} onClose={() => setAdding(false)} title={album.title} trackIds={tracks?.map((tr) => tr.id) ?? []} />
      {admin ? <AlbumMatchSheet album={matching ? album : null} onClose={() => setMatching(false)} /> : null}
    </>
  );
}

// ---------- Album sort, kept on this phone ----------

const ALBUM_SORT_KEY = "murmur.albumSort";
let sortValue: AlbumSort = getJson<AlbumSort>(ALBUM_SORT_KEY) ?? "added";
const sortListeners = new Set<() => void>();

function setAlbumSort(next: AlbumSort) {
  sortValue = next;
  setJson(ALBUM_SORT_KEY, next);
  sortListeners.forEach((l) => l());
}

export function useAlbumSort(): AlbumSort {
  return useSyncExternalStore(
    (l) => {
      sortListeners.add(l);
      return () => sortListeners.delete(l);
    },
    () => sortValue,
  );
}

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

// The + badge is light on any cover, in either theme.
const BADGE_LIGHT = "#f3f1ec";
const BADGE_INK = "#141833";

/**
 * Cover with the title and artist under it, for album grids. With `badge`, a round button on the
 * cover adds the whole album to your music (+), or takes it out again when every song is in (✓).
 */
export const AlbumCard = memo(function AlbumCard({ album, width, sub, badge }: { album: AlbumSummary; width: number; sub?: string | null; badge?: boolean }) {
  const t = useTheme();
  const all = albumInMusic(album) === "all";
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
        {badge ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={all ? `Remove ${album.title} from your music` : `Add ${album.title} to your music`}
            accessibilityState={{ checked: all }}
            hitSlop={6}
            onPress={() => {
              selectHaptic();
              void setInMusic({ albums: [album] }, !all);
            }}
            style={{
              position: "absolute",
              right: 8,
              bottom: 8,
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: all ? t.accent : BADGE_LIGHT,
              elevation: 4,
            }}
          >
            {all ? <CheckIcon size={18} color={t.onAccent} /> : <PlusIcon size={18} color={BADGE_INK} />}
          </Pressable>
        ) : null}
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
        width: round ? 48 : undefined,
        height: 48,
        borderRadius: 24,
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
        <SheetItem label="Remove from Up Next" onPress={run(async () => removeWaiting(ref), "Removed from Up Next")} />
      ) : (
        <SheetItem label="Add to Up Next" onPress={run(() => addToUpNext(ref, "next"), "Added to Up Next")} />
      )}
      <SheetItem label="Add to playlist…" onPress={onAddToPlaylist} />
      {hideAlbum ? null : <SheetItem label="Go to album" onPress={close(() => openAlbum(track.albumId))} />}
      {own ? (
        <SheetItem
          label={own.status === "downloading" ? `Cancel download, ${Math.round(own.progress * 100)}%` : "Remove download"}
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

/** Whether this song is the one playing, for drawing it in the accent colour. */
/** "playing" or "paused" while this song is the one loaded, else null; only that row renders again. */
export const usePlayingSong = (id: string) => useNowPlaying((s) => isCurrent(s, "track", id));

/**
 * A song with its album's cover, title, "Artist, Album" and length; `toggle` adds a + / ✓ at the
 * end. With `onPlay` a tap plays it, otherwise it opens its album.
 */
export const SongRow = memo(function SongRow({
  track,
  toggle,
  onPlay,
  onMore,
}: {
  track: TrackDto;
  toggle?: boolean;
  /** Called with the row's song, so a long list can pass one function to every row and keep the memo. */
  onPlay?: (track: TrackDto) => void;
  /** The ⋯ button and a long press: the song's menu. */
  onMore?: (track: TrackDto) => void;
}) {
  const t = useTheme();
  const playing = usePlayingSong(track.id);
  const more = onMore ? () => onMore(track) : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={onPlay ? "Plays this song" : "Opens its album"}
      onPress={onPlay ? () => onPlay(track) : () => openAlbum(track.albumId)}
      onLongPress={withLongPressHaptic(more)}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, borderBottomWidth: 1, borderBottomColor: t.line, opacity: pressed ? 0.7 : 1 })}
    >
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
      {toggle ? <InMusicToggle track={track} /> : null}
      {more ? <SongMoreButton track={track} onPress={more} last /> : null}
    </Pressable>
  );
});

export function SongMoreButton({ track, onPress, last }: { track: TrackDto; onPress: () => void; last?: boolean }) {
  const t = useTheme();
  return (
    <IconButton label={`More for ${track.title}`} onPress={onPress} style={{ width: 36, marginLeft: -6, marginRight: last ? -8 : 0 }}>
      <MoreIcon size={20} color={t.muted} />
    </IconButton>
  );
}

/** A numbered song on an album: number, title (and its own artist when it differs), length, + / ✓. */
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
      <InMusicToggle track={track} />
      {onMore ? <SongMoreButton track={track} onPress={onMore} last /> : null}
    </View>
  );
}

/** An album you haven't fully added, as a search result: cover, title, "Album, year" and a + button. */
export function AlbumAddRow({ album }: { album: AlbumSummary }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, borderBottomWidth: 1, borderBottomColor: t.line }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => openAlbum(album.id)}
        style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.7 : 1 })}
      >
        <Cover path={albumCover(album.id, album.coverHash)} title="" color={album.coverColor} size={44} radius={6} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 15 }}>
            {album.title}
          </Text>
          <Text variant="small" numberOfLines={1}>
            {album.year ? `Album, ${album.year}` : "Album"}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add ${album.title} to your music`}
        onPress={() => {
          selectHaptic();
          void setInMusic({ albums: [album] }, true);
        }}
        style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: t.line, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
      >
        <PlusIcon size={18} color={t.text} />
      </Pressable>
    </View>
  );
}

/** Adds one song to your music (+), or takes it out (✓ in the accent colour). */
export function InMusicToggle({ track }: { track: TrackDto }) {
  const t = useTheme();
  const on = track.inMusic;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={on ? `Remove ${track.title} from your music` : `Add ${track.title} to your music`}
      accessibilityState={{ checked: on }}
      onPress={() => {
        selectHaptic();
        void setInMusic({ tracks: [track] }, !on);
      }}
      style={({ pressed }) => ({ width: 40, height: 44, marginRight: -6, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
    >
      {on ? <CheckIcon size={20} color={t.accent} /> : <PlusIcon size={20} color={t.muted} />}
    </Pressable>
  );
}

function Length({ track }: { track: TrackDto }) {
  const t = useTheme();
  return <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: t.muted, fontVariant: ["tabular-nums"] }}>{songLength(track)}</Text>;
}

/** The accent Play button over an album, playlist or your songs. */
/** Where the songs on a screen play from: an album, a playlist, or Songs (refId null). */
export type MusicRef = { kind: UpNextSource["kind"]; refId: string | null };

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

// Kept in ui.tsx so screens that don't need the music helpers can use them too.
export { Pill, Pills };
