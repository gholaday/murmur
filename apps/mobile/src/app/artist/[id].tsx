import { ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { artistSub } from "@murmur/shared/client";
import { Grid, PAD, useGridWidth } from "@/components/library";
import { BottomMiniPlayer } from "@/components/mini-player";
import { AlbumCard, SongRow } from "@/components/music";
import { BackRow, Empty, PageTitle, SectionTitle, useBottomPad, useTopInset } from "@/components/page";
import { usePullRefresh } from "@/components/pull-refresh";
import { Bone, CoverGridBones, FadeIn, Skeleton, useJustLoaded } from "@/components/skeleton";
import { useArtist } from "@/lib/data";
import { useTheme } from "@/theme";

/** An artist's own albums, newest first, then songs of theirs on other albums. */
export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const top = useTopInset();
  const bottom = useBottomPad();
  const width = useGridWidth(2);
  const artist = useArtist(id);
  const refresh = usePullRefresh(artist.refetch);
  const fade = useJustLoaded(!artist.isPending);
  const a = artist.data;

  let body: React.ReactNode;
  if (a) {
    body = (
      <FadeIn when={fade}>
        <PageTitle title={a.name} sub={artistSub(a)} />
        {a.albums.length ? (
          <View style={{ marginTop: 16 }}>
            <Grid>
              {a.albums.map((al) => (
                <AlbumCard key={al.id} album={al} width={width} sub={al.year} />
              ))}
            </Grid>
          </View>
        ) : null}
        {a.appearsOn.length ? (
          <>
            <SectionTitle title="Appears on" count={a.appearsOn.length} />
            {a.appearsOn.map((tr) => (
              <SongRow key={tr.id} track={tr} />
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
        <Bone width="60%" height={30} style={{ marginTop: 8 }} />
        <CoverGridBones count={4} columns={2} />
      </Skeleton>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: bottom }} refreshControl={refresh}>
        <BackRow />
        {body}
      </ScrollView>
      <BottomMiniPlayer />
    </View>
  );
}
