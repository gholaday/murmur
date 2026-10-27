import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { albumCover, albumDiscs, albumInMusic, albumPills, plural, songNumber } from "@murmur/shared/client";
import { Cover } from "@/components/cover";
import { DownloadIcon, MoreIcon, PlayIcon, PlusIcon, ShuffleIcon } from "@/components/icons";
import { PAD } from "@/components/library";
import { BottomMiniPlayer } from "@/components/mini-player";
import { openArtist, Pill, TrackRow } from "@/components/music";
import { BackRow, Empty, SectionTitle, useBottomPad, useTopInset } from "@/components/page";
import { usePullRefresh } from "@/components/pull-refresh";
import { Sheet, SheetItem } from "@/components/sheet";
import { Bone, FadeIn, Skeleton, useJustLoaded } from "@/components/skeleton";
import { IconButton, Text } from "@/components/ui";
import { setInMusic, useAlbum } from "@/lib/data";
import { selectHaptic } from "@/lib/haptics";
import { fonts, useTheme } from "@/theme";

const COVER = 140;

/** One album: cover, title, artist, year and length, then its songs in order. */
export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const top = useTopInset();
  const bottom = useBottomPad();
  const album = useAlbum(id);
  const refresh = usePullRefresh(album.refetch);
  const fade = useJustLoaded(!album.isPending);
  const a = album.data;
  const state = a ? albumInMusic(a) : "none";
  const [more, setMore] = useState(false);

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
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {state === "all" ? <Pill label="In your music" check /> : null}
              {albumPills(a).map((p) => (
                <Pill key={p} label={p} />
              ))}
            </View>
          </View>
        </View>

        {/* TODO(music part B): play, shuffle and download the album. */}
        {state === "all" ? (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <ActionButton label="Play" primary icon={<PlayIcon size={20} color={t.onAccent} />} />
            <ActionButton label="Shuffle" icon={<ShuffleIcon size={20} color={t.text} />} />
            <ActionButton label="Download album" icon={<DownloadIcon size={20} color={t.text} />} round />
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
              <ActionButton label="Play" icon={<PlayIcon size={20} color={t.text} />} round />
            </View>
            <Text variant="small" style={{ textAlign: "center" }}>
              {state === "some"
                ? `${a.songsInMusic} of ${plural(a.trackCount, "song")} in your music. Tap + on any song to add just that one.`
                : "Tap + on any song to add just that one."}
            </Text>
          </View>
        )}

        {/* One group without a heading for a single disc; "Disc N" above each otherwise. */}
        {albumDiscs(a.tracks).map((d) => (
          <View key={d.disc ?? "all"}>
            {d.disc !== null ? <SectionTitle title={`Disc ${d.disc}`} /> : null}
            {d.tracks.map((tr, i) => (
              <TrackRow key={tr.id} track={tr} n={songNumber(tr, i)} albumArtistId={a.artistId} />
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
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: bottom }} refreshControl={refresh}>
        <BackRow
          right={
            a ? (
              <IconButton label="More for this album" onPress={() => setMore(true)}>
                <MoreIcon size={22} color={t.text} />
              </IconButton>
            ) : null
          }
        />
        <View style={{ marginTop: 8 }}>{body}</View>
      </ScrollView>
      <BottomMiniPlayer />
      {a ? (
        // TODO(music part B): Play next and Add to Up Next.
        <Sheet open={more} onClose={() => setMore(false)} title={a.title}>
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
    </View>
  );
}

/** The album's buttons. Without `onPress` it's drawn but disabled: Play, Shuffle and Download work in part B. */
function ActionButton({
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
