import { useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { albumCover, type PlaylistDetail, type TrackDto } from "@murmur/shared/client";
import { Facts, HERO_COVER, HeroBackdrop, HeroBones, ItemHero } from "@/components/hero";
import { MoreIcon, PlusIcon } from "@/components/icons";
import { PAD } from "@/components/library";
import { BottomMiniPlayer } from "@/components/mini-player";
import { ActionButton, PlayButton, ShuffleButton, SongRow, SongSheet } from "@/components/music";
import { BackRow, Empty, useBottomPad, useTopInset } from "@/components/page";
import { PlaylistActions, PlaylistCover, playlistFacts } from "@/components/playlists";
import { usePullRefresh } from "@/components/pull-refresh";
import { SheetItem } from "@/components/sheet";
import { Bone, FadeIn, ListRowBone, Skeleton, useJustLoaded } from "@/components/skeleton";
import { SortableList, SortableScrollView } from "@/components/sortable-list";
import { toast } from "@/components/toast";
import { ACTION_HEIGHT, IconButton, Text } from "@/components/ui";
import { keys, updatePlaylist, usePlaylist } from "@/lib/data";
import { jumpToSection } from "@/lib/library";
import { queryClient } from "@/lib/query";
import { type MusicSource, playMusic } from "@/player/engine";
import { useTheme } from "@/theme";

/** One of your playlists: play or shuffle it, drag songs to reorder, remove them, rename or delete it. */
export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const top = useTopInset();
  const bottom = useBottomPad();
  const playlist = usePlaylist(id);
  const refresh = usePullRefresh(playlist.refetch);
  const fade = useJustLoaded(!playlist.isPending);
  const p = playlist.data;
  const [more, setMore] = useState(false);
  const [song, setSong] = useState<TrackDto | null>(null);
  const source: MusicSource | null = p ? { kind: "playlist", refId: p.id, title: p.name, tracks: p.tracks } : null;
  const first = p?.covers[0];
  const firstCover = first ? albumCover(first.albumId, first.coverHash, 600) : null;

  // Shown at once; the server's answer replaces it, and a failure puts the old order back.
  const setOrder = (tracks: TrackDto[]) => {
    const before = queryClient.getQueryData<PlaylistDetail>(keys.playlist(id));
    if (!before) return;
    queryClient.setQueryData<PlaylistDetail>(keys.playlist(id), { ...before, tracks });
    updatePlaylist(id, { trackIds: tracks.map((tr) => tr.id) }).catch((err: unknown) => {
      queryClient.setQueryData(keys.playlist(id), before);
      toast.error(err instanceof Error ? err.message : "Couldn't save the playlist.");
    });
  };
  const addSongs = () => router.push({ pathname: "/add-songs", params: { id } });
  const remove = (track: TrackDto) => {
    if (!p) return;
    const before = p.tracks;
    setOrder(before.filter((tr) => tr.id !== track.id));
    toast.show("Removed from the playlist", { action: { label: "Undo", onPress: () => setOrder(before) }, duration: 5000 });
  };

  let body: React.ReactNode;
  if (p && source) {
    body = (
      <FadeIn when={fade} style={{ gap: 16 }}>
        <ItemHero
          cover={null}
          color={null}
          title={p.name}
          art={<PlaylistCover playlist={p} size={HERO_COVER} radius={12} />}
          above={
            <Text variant="small" style={{ marginTop: 14, color: t.text2 }}>
              Playlist
            </Text>
          }
        >
          <Facts items={playlistFacts(p)} />
        </ItemHero>

        {p.tracks.length ? (
          <>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
              <PlayButton from={source} opensPlayer onPress={() => playMusic(source, -1)} />
              <ShuffleButton from={source} onPlay={() => playMusic(source, -1, true)} />
              <ActionButton label="Add songs" round icon={<PlusIcon size={22} color={t.text} />} onPress={addSongs} />
            </View>
            <View style={{ marginHorizontal: -8 }}>
              <SortableList
                items={p.tracks}
                keyOf={(tr) => tr.id}
                onReorder={(ids) => {
                  const byId = new Map(p.tracks.map((tr) => [tr.id, tr]));
                  setOrder(ids.flatMap((k) => byId.get(k) ?? []));
                }}
                renderRow={(tr, i) => <SongRow track={tr} sortable onPlay={() => playMusic(source, i)} onMore={setSong} />}
              />
            </View>
          </>
        ) : (
          <View style={{ alignItems: "center", gap: 16 }}>
            <Empty title="No songs yet">Find songs and add them with one tap.</Empty>
            <View style={{ width: 180 }}>
              <ActionButton label="Add songs" primary icon={<PlusIcon size={20} color={t.onAccent} />} onPress={addSongs} />
            </View>
          </View>
        )}
      </FadeIn>
    );
  } else if (playlist.isError) {
    body = <Empty title="Couldn't load this playlist">{playlist.error.message}</Empty>;
  } else {
    body = (
      <Skeleton style={{ gap: 16 }}>
        <HeroBones />
        <Bone height={ACTION_HEIGHT} radius={ACTION_HEIGHT / 2} style={{ marginTop: 6 }} />
        {[0, 1, 2, 3, 4].map((i) => (
          <ListRowBone key={i} thumb={44} />
        ))}
      </Skeleton>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <SortableScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: bottom }} refreshControl={refresh}>
        {/* Tinted from the first album, as the web's is. */}
        {p ? <HeroBackdrop path={firstCover} color={null} height={top + 460} /> : null}
        <BackRow
          right={
            p ? (
              <IconButton label="Playlist options" onPress={() => setMore(true)} style={{ marginRight: -10 }}>
                <MoreIcon color={t.text} />
              </IconButton>
            ) : null
          }
        />
        {body}
      </SortableScrollView>
      <BottomMiniPlayer />
      <SongSheet
        track={song}
        onClose={() => setSong(null)}
        extra={(track, close) => (
          <SheetItem
            label="Remove from this playlist"
            danger
            onPress={() => {
              close();
              remove(track);
            }}
          />
        )}
      />
      {p ? <PlaylistActions playlist={p} open={more} onClose={() => setMore(false)} onDeleted={() => {
        // Replaced, not gone back to, like the web: Library on Music.
        jumpToSection("music");
        router.replace("/");
      }} /> : null}
    </View>
  );
}
