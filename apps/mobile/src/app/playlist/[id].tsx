import { useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { type PlaylistDetail, type TrackDto } from "@murmur/shared/client";
import { MoreIcon, PlusIcon } from "@/components/icons";
import { PAD } from "@/components/library";
import { BottomMiniPlayer } from "@/components/mini-player";
import { ActionButton, addSongsToUpNext, Pills, PlayButton, ShuffleButton, SongRow, SongSheet } from "@/components/music";
import { BackRow, Empty, useBottomPad, useTopInset } from "@/components/page";
import { NamePlaylistSheet, PlaylistCover, playlistPills } from "@/components/playlists";
import { usePullRefresh } from "@/components/pull-refresh";
import { ConfirmSheet, Sheet, SheetItem } from "@/components/sheet";
import { Bone, FadeIn, ListRowBone, Skeleton, useJustLoaded } from "@/components/skeleton";
import { SortableList, SortableScrollView } from "@/components/sortable-list";
import { toast } from "@/components/toast";
import { Caption, IconButton, Text } from "@/components/ui";
import { deletePlaylist, keys, updatePlaylist, usePlaylist } from "@/lib/data";
import { queryClient } from "@/lib/query";
import { type MusicSource, playMusic } from "@/player/engine";
import { fonts, useTheme } from "@/theme";

const COVER = 140;

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
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [song, setSong] = useState<TrackDto | null>(null);
  const source: MusicSource | null = p ? { kind: "playlist", refId: p.id, title: p.name, tracks: p.tracks } : null;

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
        <View style={{ flexDirection: "row", gap: 16, alignItems: "flex-end" }}>
          <PlaylistCover playlist={p} size={COVER} />
          <View style={{ flex: 1, gap: 6 }}>
            <Caption>Playlist</Caption>
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 24, lineHeight: 30, letterSpacing: -0.4, color: t.text }}>{p.name}</Text>
            <Pills labels={playlistPills(p)} />
          </View>
        </View>

        {p.tracks.length ? (
          <>
            <View style={{ flexDirection: "row", gap: 10 }}>
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
        <View style={{ flexDirection: "row", gap: 16, alignItems: "flex-end" }}>
          <Bone width={COVER} height={COVER} radius={12} />
          <View style={{ flex: 1, gap: 10 }}>
            <Bone width="40%" height={12} />
            <Bone width="80%" height={22} />
            <Bone width="60%" height={22} radius={11} />
          </View>
        </View>
        <Bone height={48} radius={24} />
        {[0, 1, 2, 3, 4].map((i) => (
          <ListRowBone key={i} thumb={44} />
        ))}
      </Skeleton>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <SortableScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: bottom }} refreshControl={refresh}>
        <BackRow
          right={
            p ? (
              <IconButton label="Playlist options" onPress={() => setMore(true)}>
                <MoreIcon size={22} color={t.text} />
              </IconButton>
            ) : null
          }
        />
        <View style={{ marginTop: 8 }}>{body}</View>
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
      {p ? (
        <>
          <Sheet open={more} onClose={() => setMore(false)} title={p.name}>
            {p.tracks.length ? (
              <SheetItem
                label="Add to queue"
                onPress={() => {
                  setMore(false);
                  void addSongsToUpNext(p.tracks);
                }}
              />
            ) : null}
            <SheetItem
              label="Rename…"
              onPress={() => {
                setMore(false);
                setRenaming(true);
              }}
            />
            <SheetItem
              label="Delete playlist"
              danger
              onPress={() => {
                setMore(false);
                setDeleting(true);
              }}
            />
          </Sheet>
          <NamePlaylistSheet
            open={renaming}
            onClose={() => setRenaming(false)}
            title="Rename playlist"
            initial={p.name}
            action="Save"
            onSubmit={async (name) => {
              await updatePlaylist(p.id, { name });
              toast.show("Renamed");
            }}
          />
          <ConfirmSheet
            open={deleting}
            title={`Delete ${p.name}?`}
            confirmLabel="Delete"
            danger
            onConfirm={() => {
              deletePlaylist(p.id).then(
                () => {
                  toast.show(`Deleted ${p.name}`);
                  if (router.canGoBack()) router.back();
                },
                (err: unknown) => toast.error(err instanceof Error ? err.message : "Couldn't delete the playlist."),
              );
            }}
            onClose={() => setDeleting(false)}
          />
        </>
      ) : null}
    </View>
  );
}
