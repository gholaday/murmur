import { useEffect, useState } from "react";
import { FlatList, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { albumCover, type PlaylistDetail, songMatches, songSub, type TrackDto } from "@murmur/shared/client";
import { Cover } from "@/components/cover";
import { AddCircleIcon } from "@/components/icons";
import { PAD } from "@/components/library";
import { BottomMiniPlayer } from "@/components/mini-player";
import { BackRow, Empty, useBottomPad, useTopInset } from "@/components/page";
import { ListRowBone, Skeleton } from "@/components/skeleton";
import { toast } from "@/components/toast";
import { Chips, IconButton, SearchBox, Text } from "@/components/ui";
import { addToPlaylist, keys, updatePlaylist, usePlaylist, useRecentTracks, useTrackSearch } from "@/lib/data";
import { queryClient } from "@/lib/query";
import { useTheme } from "@/theme";

const VIEWS = [
  { id: "mine", label: "Your songs" },
  { id: "recent", label: "Recently played" },
  { id: "all", label: "Browse" },
] as const;
type View_ = (typeof VIEWS)[number]["id"];

/** Waits until the text has stopped changing for a moment, so a search doesn't run on every key. */
function useDebounced(value: string, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Add songs to a playlist: search your songs, what you've played lately, or everything on the
 * server, and add or take out each with one tap. Browse songs go in the playlist only, not
 * into your music.
 */
export default function AddSongsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const top = useTopInset();
  const bottom = useBottomPad();
  const playlist = usePlaylist(id);
  const [view, setView] = useState<View_>("mine");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const mine = useTrackSearch("mine", q, view === "mine");
  const all = useTrackSearch("all", q, view === "all");
  const recent = useRecentTracks(view === "recent");
  const current = view === "mine" ? mine : view === "all" ? all : recent;
  const list = view === "recent" ? (recent.data ?? []).filter((s) => songMatches(s, q)) : (current.data ?? []);
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
      <Chips gap={8} options={VIEWS} value={view} onPick={setView} />
    </View>
  );

  const empty = current.isPending ? (
    <Skeleton>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <ListRowBone key={i} thumb={44} buttons={1} />
      ))}
    </Skeleton>
  ) : (
    <Empty>{q ? `No songs match "${q}".` : view === "recent" ? "Songs you play show up here." : "No songs yet."}</Empty>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={list}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: bottom }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
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
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, borderBottomWidth: 1, borderBottomColor: t.line }}>
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
