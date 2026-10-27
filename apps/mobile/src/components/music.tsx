import { memo, useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import {
  ALBUM_SORTS,
  albumCover,
  type AlbumSort,
  type AlbumSummary,
  guestArtist,
  songLength,
  songSub,
  type TrackDto,
} from "@murmur/shared/client";
import { getJson, setJson } from "@/lib/storage";
import { fonts, useTheme } from "@/theme";
import { Cover } from "./cover";
import { MoreIcon } from "./icons";
import { Sheet, SheetItem } from "./sheet";
import { Text } from "./ui";

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

/** Cover with the title and artist under it, for album grids. */
export const AlbumCard = memo(function AlbumCard({ album, width, sub }: { album: AlbumSummary; width: number; sub?: string | null }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${album.title}, ${album.artist}`}
      onPress={() => openAlbum(album.id)}
      style={({ pressed }) => ({ width, gap: 8, opacity: pressed ? 0.75 : 1 })}
    >
      <Cover path={albumCover(album.id, album.coverHash, 600)} title={album.title} color={album.coverColor} />
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

/** A song with its album's cover, title, "Artist, Album" and length. */
export const SongRow = memo(function SongRow({ track }: { track: TrackDto }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens its album"
      onPress={() => openAlbum(track.albumId)}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, borderBottomWidth: 1, borderBottomColor: t.line, opacity: pressed ? 0.7 : 1 })}
    >
      <Cover path={albumCover(track.albumId, track.coverHash)} title="" size={44} radius={6} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 15 }}>
          {track.title}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {songSub(track)}
        </Text>
      </View>
      <Length track={track} />
    </Pressable>
  );
});

/** A numbered song on an album: number, title (and its own artist when it differs), length, more. */
export function TrackRow({ track, n, albumArtistId }: { track: TrackDto; n: number; albumArtistId: string }) {
  const t = useTheme();
  const guest = guestArtist(track, albumArtistId);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, borderBottomWidth: 1, borderBottomColor: t.line }}>
      <Text style={{ width: 24, textAlign: "right", fontFamily: fonts.semibold, fontSize: 13, color: t.muted, fontVariant: ["tabular-nums"] }}>{n}</Text>
      <View style={{ flex: 1, gap: 2, paddingVertical: 8 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 15, color: t.text }}>
          {track.title}
        </Text>
        {guest ? (
          <Text variant="small" numberOfLines={1}>
            {guest}
          </Text>
        ) : null}
      </View>
      <Length track={track} />
      {/* TODO(music part B): play next, add to Up Next, go to artist. */}
      <Pressable accessibilityRole="button" accessibilityLabel={`More for ${track.title}`} disabled style={{ width: 32, height: 44, alignItems: "center", justifyContent: "center", opacity: 0.4 }}>
        <MoreIcon size={20} color={t.muted} />
      </Pressable>
    </View>
  );
}

function Length({ track }: { track: TrackDto }) {
  const t = useTheme();
  return <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: t.muted, fontVariant: ["tabular-nums"] }}>{songLength(track)}</Text>;
}

/** A small grey label, for an album's year, song count and length. */
export function Pill({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View style={{ height: 24, paddingHorizontal: 9, borderRadius: 12, justifyContent: "center", backgroundColor: t.chip }}>
      <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: t.text2 }}>{label}</Text>
    </View>
  );
}
