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
  songLength,
  songSub,
  type TrackDto,
} from "@murmur/shared/client";
import { setInMusic } from "@/lib/data";
import { selectHaptic } from "@/lib/haptics";
import { downloadTrack, removeDownload, useDownload, useInAlbumDownload } from "@/lib/downloads";
import { getJson, setJson } from "@/lib/storage";
import { isCurrent, playNext, queueAdd, usePlayer } from "@/player/engine";
import { fonts, useTheme } from "@/theme";
import { Cover } from "./cover";
import { CheckIcon, MoreIcon, PlayIcon, PlusIcon, ShuffleIcon } from "./icons";
import { AddToPlaylistSheet } from "./playlists";
import { Sheet, SheetItem } from "./sheet";
import { toast } from "./toast";
import { IconButton, Text } from "./ui";

// Shared by the Music tab, Album and Artist screens. The text helpers (songSub, albumPills and so
// on) live in @murmur/shared, so the web and the app say the same thing.

export const openAlbum = (id: string) => router.push(`/album/${id}`);
export const openArtist = (id: string) => router.push(`/artist/${id}`);

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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${album.title}, ${album.artist}`}
      onPress={() => openAlbum(album.id)}
      style={({ pressed }) => ({ width, gap: 8, opacity: pressed ? 0.75 : 1 })}
    >
      <View>
        <Cover path={albumCover(album.id, album.coverHash, 600)} title={album.title} color={album.coverColor} />
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
        <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14 }}>
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
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  primary?: boolean;
  round?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !onPress }}
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
 * A song's ⋯ menu (also a long press): play next, add to Up Next or a playlist, go to its album,
 * download it on its own (or remove that copy), then any `extra` items.
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
  return (
    <>
      <SheetItem label="Play next" onPress={run(() => playNext(track), "Playing next")} />
      <SheetItem label="Add to Up Next" onPress={run(() => queueAdd({ itemType: "track", itemId: track.id }, "last"), "Added to Up Next")} />
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
export const usePlayingSong = (id: string) => isCurrent(usePlayer(), "track", id);

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
  onPlay?: () => void;
  /** The ⋯ button and a long press: the song's menu. */
  onMore?: () => void;
}) {
  const t = useTheme();
  const playing = usePlayingSong(track.id);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={onPlay ? "Plays this song" : "Opens its album"}
      onPress={onPlay ?? (() => openAlbum(track.albumId))}
      onLongPress={onMore}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, borderBottomWidth: 1, borderBottomColor: t.line, opacity: pressed ? 0.7 : 1 })}
    >
      <Cover path={albumCover(track.albumId, track.coverHash)} title="" size={44} radius={6} />
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
      {onMore ? <SongMoreButton track={track} onPress={onMore} last /> : null}
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
        onLongPress={onMore}
        style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.7 : 1 })}
      >
        <Text
          style={{ width: 24, textAlign: "right", fontFamily: fonts.semibold, fontSize: 13, color: playing ? t.accent : t.muted, fontVariant: ["tabular-nums"] }}
        >
          {n}
        </Text>
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
export function PlayButton({ label = "Play", onPress }: { label?: string; onPress: () => void }) {
  const t = useTheme();
  return <ActionButton label={label} primary icon={<PlayIcon size={20} color={t.onAccent} />} onPress={onPress} />;
}

/** The Shuffle button beside Play. */
export function ShuffleButton({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  return <ActionButton label="Shuffle" icon={<ShuffleIcon size={20} color={t.text} />} onPress={onPress} />;
}

/** A wrapping row of Pills, under a title. */
export function Pills({ labels, children }: { labels: string[]; children?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {children}
      {labels.map((label) => (
        <Pill key={label} label={label} />
      ))}
    </View>
  );
}

/** A small grey label, for an album's year, song count and length; `check` marks "In your music". */
export function Pill({ label, check }: { label: string; check?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ height: 24, paddingHorizontal: 9, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: t.chip }}>
      {check ? <CheckIcon size={13} color={t.accent} /> : null}
      <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: t.text2 }}>{label}</Text>
    </View>
  );
}
