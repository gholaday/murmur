import { useState } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { albumInMusic, artistImage, artistSub, plural, type TrackDto } from "@murmur/shared/client";
import { Cover } from "@/components/cover";
import { MoreIcon, PlusIcon, ProfileIcon } from "@/components/icons";
import { Grid, useGridWidth } from "@/components/library";
import { ArtistPhotoSheet } from "@/components/match";
import { AlbumCard, SongRow, SongSheet } from "@/components/music";
import { Empty, NestedScreen, PageTitle, SectionTitle } from "@/components/page";
import { usePullRefresh } from "@/components/pull-refresh";
import { Sheet, SheetItem } from "@/components/sheet";
import { Bone, CoverGridBones, FadeIn, Skeleton, useJustLoaded } from "@/components/skeleton";
import { IconButton, Text } from "@/components/ui";
import { setInMusic, useArtist } from "@/lib/data";
import { selectHaptic } from "@/lib/haptics";
import { useSession } from "@/lib/session";
import { playMusic } from "@/player/engine";
import { fonts, useTheme } from "@/theme";

const PHOTO = 96;

/** All of an artist's albums, newest first, then songs of theirs on other albums; each can be added. */
export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const width = useGridWidth();
  const artist = useArtist(id);
  const refresh = usePullRefresh(artist.refetch);
  const fade = useJustLoaded(!artist.isPending);
  const a = artist.data;
  // Albums not fully in your music yet; the button adds them all.
  const missing = a?.albums.filter((al) => albumInMusic(al) !== "all") ?? [];
  const added = (a?.albums.length ?? 0) - missing.length;
  const photo = a ? artistImage(a, 600) : null;
  const [song, setSong] = useState<TrackDto | null>(null);
  const [menu, setMenu] = useState(false);
  const [changing, setChanging] = useState(false);
  const admin = !!useSession().user?.isAdmin;

  let body: React.ReactNode;
  if (a) {
    body = (
      <FadeIn when={fade}>
        {/* Their photo beside the name, like the web; an album cover of theirs, else a person icon. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          {photo ? (
            <Cover path={photo} title={a.name} size={PHOTO} radius={PHOTO / 2} />
          ) : (
            <View style={{ width: PHOTO, height: PHOTO, borderRadius: PHOTO / 2, backgroundColor: t.surface, alignItems: "center", justifyContent: "center" }}>
              <ProfileIcon size={40} color={t.muted} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <PageTitle title={a.name} sub={added ? `${artistSub(a)}, ${added} in your music` : artistSub(a)} />
          </View>
        </View>
        {missing.length ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              selectHaptic();
              void setInMusic({ albums: missing }, true);
            }}
            style={({ pressed }) => ({
              marginTop: 12,
              height: 44,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: t.line,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <PlusIcon size={18} color={t.text} />
            <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: t.text }}>
              {added ? `Add the other ${plural(missing.length, "album")}` : missing.length === 1 ? "Add the album" : `Add all ${missing.length} albums`}
            </Text>
          </Pressable>
        ) : null}
        {a.albums.length ? (
          <View style={{ marginTop: 16 }}>
            <Grid>
              {a.albums.map((al) => (
                <AlbumCard key={al.id} album={al} width={width} sub={al.year} badge />
              ))}
            </Grid>
          </View>
        ) : null}
        {a.appearsOn.length ? (
          <>
            <SectionTitle title="Appears on" count={a.appearsOn.length} />
            {a.appearsOn.map((tr) => (
              <SongRow
                key={tr.id}
                track={tr}
                toggle
                onPlay={() => playMusic({ kind: "artist", refId: a.id, title: a.name, tracks: a.appearsOn }, a.appearsOn.indexOf(tr))}
                onMore={() => setSong(tr)}
              />
            ))}
          </>
        ) : null}
      </FadeIn>
    );
  } else if (artist.isError) {
    body = <Empty title="Couldn't load this artist">{artist.error.message}</Empty>;
  } else {
    body = (
      <Skeleton style={{ gap: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <Bone width={PHOTO} height={PHOTO} radius={PHOTO / 2} />
          <View style={{ flex: 1, gap: 10 }}>
            <Bone width="70%" height={30} />
            <Bone width="45%" height={14} />
          </View>
        </View>
        <CoverGridBones count={6} />
      </Skeleton>
    );
  }

  return (
    <NestedScreen
      refreshControl={refresh}
      right={
        admin && a ? (
          <IconButton label="Artist options" onPress={() => setMenu(true)}>
            <MoreIcon size={22} color={t.text} />
          </IconButton>
        ) : null
      }
      after={
        <>
          <SongSheet track={song} onClose={() => setSong(null)} />
          {admin && a ? (
            <>
              <Sheet open={menu} onClose={() => setMenu(false)} title={a.name}>
                <SheetItem
                  label="Change photo…"
                  onPress={() => {
                    setMenu(false);
                    setChanging(true);
                  }}
                />
              </Sheet>
              <ArtistPhotoSheet artist={changing ? a : null} onClose={() => setChanging(false)} />
            </>
          ) : null}
        </>
      }
    >
      {body}
    </NestedScreen>
  );
}
