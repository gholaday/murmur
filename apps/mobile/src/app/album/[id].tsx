import { useState } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { albumCover, type AlbumDetail, albumDiscs, albumInMusic, albumPills, plural, songNumber, type TrackDto } from "@murmur/shared/client";
import { Cover } from "@/components/cover";
import { CheckIcon, DownloadIcon, MoreIcon, PlusIcon } from "@/components/icons";
import { ActionButton, addSongsToUpNext, openArtist, Pills, PlayButton, ShuffleButton, SongSheet, TrackRow } from "@/components/music";
import { Empty, NestedScreen, SectionTitle } from "@/components/page";
import { AddToPlaylistSheet } from "@/components/playlists";
import { usePullRefresh } from "@/components/pull-refresh";
import { RemoveDownloadSheet, Sheet, SheetItem } from "@/components/sheet";
import { Bone, FadeIn, Skeleton, useJustLoaded } from "@/components/skeleton";
import { IconButton, Text } from "@/components/ui";
import { setInMusic, useAlbum } from "@/lib/data";
import { downloadAlbum, removeDownload, useDownload } from "@/lib/downloads";
import { selectHaptic } from "@/lib/haptics";
import { playMusic } from "@/player/engine";
import { fonts, useTheme } from "@/theme";

const COVER = 140;

const playAlbum = (a: AlbumDetail, index: number, shuffle = false) =>
  playMusic({ kind: "album", refId: a.id, title: a.title, tracks: a.tracks }, index, shuffle);

/** One album: cover, title, artist, year and length, then its songs in order. */
export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const album = useAlbum(id);
  const refresh = usePullRefresh(album.refetch);
  const fade = useJustLoaded(!album.isPending);
  const a = album.data;
  const state = a ? albumInMusic(a) : "none";
  const [more, setMore] = useState(false);
  const [song, setSong] = useState<TrackDto | null>(null);
  const [adding, setAdding] = useState(false);

  let body: React.ReactNode;
  if (a) {
    body = (
      <FadeIn when={fade} style={{ gap: 16 }}>
        <View style={{ flexDirection: "row", gap: 16, alignItems: "flex-end" }}>
          <Cover path={albumCover(a.id, a.coverHash, 600)} title={a.title} color={a.coverColor} size={COVER} radius={12} />
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 24, lineHeight: 30, letterSpacing: -0.4, color: t.text }}>{a.title}</Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => openArtist(a.artistId)}
              hitSlop={6}
              style={({ pressed }) => ({ alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}
            >
              <Text numberOfLines={2} style={{ fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, color: t.accent }}>
                {a.artist}
              </Text>
            </Pressable>
            <Pills labels={albumPills(a)} />
          </View>
        </View>

        {state === "all" ? (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <PlayButton from={{ kind: "album", refId: a.id }} opensPlayer onPress={() => playAlbum(a, -1)} />
            <ShuffleButton from={{ kind: "album", refId: a.id }} onPlay={() => playAlbum(a, -1, true)} />
            <AlbumDownloadButton album={a} />
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <ActionButton
                label={state === "some" ? `Add the other ${plural(a.trackCount - a.songsInMusic, "song")}` : "Add to your music"}
                primary
                icon={<PlusIcon size={20} color={t.onAccent} />}
                onPress={() => {
                  selectHaptic();
                  void setInMusic({ albums: [a] }, true);
                }}
              />
              <PlayButton from={{ kind: "album", refId: a.id }} round opensPlayer onPress={() => playAlbum(a, -1)} />
            </View>
            {state === "some" ? (
              <Text variant="small" style={{ textAlign: "center" }}>
                {`${a.songsInMusic} of ${plural(a.trackCount, "song")} in your music`}
              </Text>
            ) : null}
          </View>
        )}

        {/* One group without a heading for a single disc; "Disc N" above each otherwise. */}
        {albumDiscs(a.tracks).map((d) => (
          <View key={d.disc ?? "all"}>
            {d.disc !== null ? <SectionTitle title={`Disc ${d.disc}`} /> : null}
            {d.tracks.map((tr, i) => (
              <TrackRow
                key={tr.id}
                track={tr}
                n={songNumber(tr, i)}
                albumArtistId={a.artistId}
                onPlay={() => playAlbum(a, a.tracks.indexOf(tr))}
                onMore={() => setSong(tr)}
              />
            ))}
          </View>
        ))}
      </FadeIn>
    );
  } else if (album.isError) {
    body = <Empty title="Couldn't load this album">{album.error.message}</Empty>;
  } else {
    body = (
      <Skeleton style={{ gap: 16 }}>
        <View style={{ flexDirection: "row", gap: 16, alignItems: "flex-end" }}>
          <Bone width={COVER} height={COVER} radius={12} />
          <View style={{ flex: 1, gap: 10 }}>
            <Bone width="80%" height={22} />
            <Bone width="50%" height={14} />
            <Bone width="70%" height={22} radius={11} />
          </View>
        </View>
        <Bone height={48} radius={24} />
        {[0, 1, 2, 3, 4].map((i) => (
          <Bone key={i} height={18} style={{ marginVertical: 19 }} />
        ))}
      </Skeleton>
    );
  }

  return (
    <NestedScreen
      refreshControl={refresh}
      right={
        a ? (
          <IconButton label="More for this album" onPress={() => setMore(true)}>
            <MoreIcon size={22} color={t.text} />
          </IconButton>
        ) : null
      }
      after={
        <>
          {a ? (
            <Sheet open={more} onClose={() => setMore(false)} title={a.title}>
              <SheetItem
                label="Add to Up Next"
                onPress={() => {
                  setMore(false);
                  void addSongsToUpNext(a.tracks);
                }}
              />
              <SheetItem
                label="Add to playlist…"
                onPress={() => {
                  setMore(false);
                  setAdding(true);
                }}
              />
              <SheetItem
                label={`Go to ${a.artist}`}
                onPress={() => {
                  setMore(false);
                  openArtist(a.artistId);
                }}
              />
              {a.songsInMusic > 0 ? (
                <SheetItem
                  label="Remove from your music"
                  danger
                  onPress={() => {
                    setMore(false);
                    void setInMusic({ albums: [a] }, false);
                  }}
                />
              ) : null}
            </Sheet>
          ) : null}
          <SongSheet track={song} onClose={() => setSong(null)} hideAlbum />
          {a ? <AddToPlaylistSheet open={adding} onClose={() => setAdding(false)} title={a.title} trackIds={a.tracks.map((tr) => tr.id)} /> : null}
        </>
      }
    >
      <View style={{ marginTop: 8 }}>{body}</View>
    </NestedScreen>
  );
}

/** The round download button: download, progress (tap to cancel), or downloaded (tap to remove). */
function AlbumDownloadButton({ album }: { album: AlbumDetail }) {
  const t = useTheme();
  const d = useDownload("album", album.id);
  const [confirm, setConfirm] = useState(false);
  const pct = d ? Math.round(d.progress * 100) : 0;
  return (
    <>
      {d?.status === "done" ? (
        <ActionButton label="Remove download" round icon={<CheckIcon size={20} color={t.accent} />} onPress={() => setConfirm(true)} />
      ) : d?.status === "downloading" ? (
        <ActionButton
          label={`Downloading ${pct}%, tap to cancel`}
          round
          icon={<Text style={{ fontFamily: fonts.bold, fontSize: 12, color: t.accent }}>{`${pct}%`}</Text>}
          onPress={() => removeDownload("album", album.id)}
        />
      ) : (
        <ActionButton
          label={d?.status === "error" ? "Download failed, try again" : "Download album"}
          round
          icon={<DownloadIcon size={20} color={d?.status === "error" ? t.danger : t.text} />}
          onPress={() => downloadAlbum(album)}
        />
      )}
      <RemoveDownloadSheet open={confirm} title={album.title} onConfirm={() => removeDownload("album", album.id)} onClose={() => setConfirm(false)} />
    </>
  );
}
