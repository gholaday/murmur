import { useState } from "react";
import { FlatList, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { albumCover, type PlaylistDetail, songSub, type TrackDto } from "@murmur/shared/client";
import { Cover } from "@/components/cover";
import { AddCircleIcon } from "@/components/icons";
import { PAD } from "@/components/library";
import { BottomMiniPlayer } from "@/components/mini-player";
import { BackRow, Empty, useBottomPad, useTopInset } from "@/components/page";
import { ListRowBone, Skeleton } from "@/components/skeleton";
import { toast } from "@/components/toast";
import { TextTabs } from "@/components/text-tabs";
import { IconButton, SearchBox, Text } from "@/components/ui";
import { addToPlaylist, keys, updatePlaylist, useLikedMusic, usePlaylist, useRecentTracks, useTrackSearch } from "@/lib/data";
import { useCanHideAndLike } from "@/lib/hidden";
import { queryClient } from "@/lib/query";
import { useDebounced } from "@/lib/search";
import { useTheme } from "@/theme";

const VIEWS = [
  { id: "recent", label: "Recently played" },
  { id: "liked", label: "Liked" },
] as const;
type View_ = (typeof VIEWS)[number]["id"];

const SONG_ROW = 64;

/**
 * Add songs to a playlist: what you've played lately or what you liked, or type to search all
 * the music on the server; add or take out each with one tap.
 */
export default function AddSongsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const top = useTopInset();
  const bottom = useBottomPad();
  const playlist = usePlaylist(id);
  const [view, setView] = useState<View_>("recent");
  const canLike = useCanHideAndLike();
  const [query, setQuery] = useState("");
  const [headerHeight, setHeaderHeight] = useState(0);
  const q = useDebounced(query.trim(), 250);
  // Typing searches all music; the chips are for browsing without a search.
  const searching = q.length > 0;
  const all = useTrackSearch(q, searching);
  const recent = useRecentTracks(!searching && view === "recent");
  const liked = useLikedMusic(!searching && view === "liked");
  const current = searching ? all : view === "recent" ? recent : liked;
  const list = searching ? (all.data ?? []) : view === "recent" ? (recent.data ?? []) : (liked.data?.tracks ?? []);
  const name = playlist.data?.name ?? "";
  const inPlaylist = new Set(playlist.data?.tracks.map((s) => s.id));

  /** The playlist as cached now, so an Undo works from the latest songs, not the ones it opened with. */
  const latest = () => queryClient.getQueryData<PlaylistDetail>(keys.playlist(id));
  /** Shows the change at once; the server's answer replaces it, and a failure puts it back. */
  const change = (tracks: TrackDto[], send: () => Promise<unknown>) => {
    const before = latest();
    if (!before) return;
    queryClient.setQueryData<PlaylistDetail>(keys.playlist(id), { ...before, tracks });
    send().catch((err: unknown) => {
      queryClient.setQueryData(keys.playlist(id), before);
      toast.error(err instanceof Error ? err.message : "Couldn't save the playlist.");
    });
  };
  const add = (song: TrackDto) => {
    const p = latest();
    if (p) change([...p.tracks.filter((s) => s.id !== song.id), song], () => addToPlaylist(id, [song.id]));
  };
  const remove = (song: TrackDto) => {
    const p = latest();
    if (!p) return;
    const tracks = p.tracks.filter((s) => s.id !== song.id);
    change(tracks, () => updatePlaylist(id, { trackIds: tracks.map((s) => s.id) }));
  };
  const toggle = (song: TrackDto) => {
    const on = !inPlaylist.has(song.id);
    if (on) add(song);
    else remove(song);
    toast.show(`${on ? "Added to" : "Removed from"} ${name}`, {
      action: { label: "Undo", onPress: () => (on ? remove(song) : add(song)) },
      duration: 5000,
    });
  };

  const header = (
    <View style={{ paddingTop: top, gap: 12, marginBottom: 8 }}>
      <View>
        <BackRow />
        <Text variant="title" numberOfLines={1} style={{ paddingVertical: 8 }}>
          {name ? `Add to ${name}` : " "}
        </Text>
      </View>
      <SearchBox value={query} onChange={setQuery} placeholder="Search songs, albums or artists" />
      {/* A server from before likes has only Recently played, so no chips. */}
      {query.trim() || !canLike ? null : <TextTabs options={VIEWS} value={view} onPick={setView} />}
    </View>
  );

  const empty = current.isPending ? (
    <Skeleton>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <ListRowBone key={i} thumb={44} buttons={1} />
      ))}
    </Skeleton>
  ) : (
    <Empty>
      {searching ? `No songs match "${q}".` : view === "recent" ? "Songs you play show up here." : "Tap the heart on any song or album to find it here."}
    </Empty>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={list}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: bottom }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={<View onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>{header}</View>}
        ListEmptyComponent={empty}
        getItemLayout={(_, index) => ({ length: SONG_ROW, offset: headerHeight + index * SONG_ROW, index })}
        renderItem={({ item }) => <AddSongRow song={item} added={inPlaylist.has(item.id)} name={name} onToggle={() => toggle(item)} />}
      />
      <BottomMiniPlayer />
    </View>
  );
}

/** A song to add: cover, title, "Artist, Album", and a plus that turns into a check once it's in. */
function AddSongRow({ song, added, name, onToggle }: { song: TrackDto; added: boolean; name: string; onToggle: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, height: SONG_ROW, borderBottomWidth: 1, borderBottomColor: t.line }}>
      <Cover path={albumCover(song.albumId, song.coverHash)} title="" size={44} radius={8} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {song.title}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {songSub(song)}
        </Text>
      </View>
      <IconButton label={added ? `Remove ${song.title} from ${name}` : `Add ${song.title} to ${name}`} onPress={onToggle} style={{ width: 44, height: 44, marginRight: -10 }}>
        <AddCircleIcon size={26} added={added} color={added ? t.accent : t.text2} checkColor={t.onAccent} />
      </IconButton>
    </View>
  );
}
