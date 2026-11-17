import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { artistImage, artistSub, plural, type TrackDto } from "@murmur/shared/client";
import { Cover } from "@/components/cover";
import { MoreIcon, ProfileIcon } from "@/components/icons";
import { Grid, useGridWidth } from "@/components/library";
import { ArtistPhotoSheet } from "@/components/match";
import { AlbumCard, SongRow, SongSheet } from "@/components/music";
import { Empty, NestedScreen, PageTitle, SectionTitle, useBackIfFocused } from "@/components/page";
import { usePullRefresh } from "@/components/pull-refresh";
import { HideItem, Sheet, SheetItem } from "@/components/sheet";
import { Bone, CoverGridBones, FadeIn, Skeleton, useJustLoaded } from "@/components/skeleton";
import { IconButton } from "@/components/ui";
import { useArtist } from "@/lib/data";
import { useCanHideAndLike } from "@/lib/hidden";
import { useIsAdmin } from "@/lib/session";
import { playMusic } from "@/player/engine";
import { useTheme } from "@/theme";

const PHOTO = 96;

/** All of an artist's albums, newest first, then songs of theirs on other albums. */
export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const width = useGridWidth();
  const artist = useArtist(id);
  const refresh = usePullRefresh(artist.refetch);
  const fade = useJustLoaded(!artist.isPending);
  const a = artist.data;
  const photo = a ? artistImage(a, 600) : null;
  const [song, setSong] = useState<TrackDto | null>(null);
  const [menu, setMenu] = useState(false);
  const [changing, setChanging] = useState(false);
  const admin = useIsAdmin();
  const canHide = useCanHideAndLike();
  const backIfHere = useBackIfFocused();

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
            <PageTitle title={a.name} sub={artistSub(a)} />
          </View>
        </View>
        {a.albums.length ? (
          <View style={{ marginTop: 16 }}>
            <Grid>
              {a.albums.map((al) => (
                <AlbumCard key={al.id} album={al} width={width} sub={al.year ?? plural(al.trackCount, "song")} />
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
        // The menu holds Change photo (admins) and Hide (servers that can).
        a && (admin || canHide) ? (
          <IconButton label="Artist options" onPress={() => setMenu(true)}>
            <MoreIcon size={22} color={t.text} />
          </IconButton>
        ) : null
      }
      after={
        <>
          <SongSheet track={song} onClose={() => setSong(null)} />
          {a ? (
            <Sheet open={menu} onClose={() => setMenu(false)} title={a.name}>
              {admin ? (
                <SheetItem
                  label="Change photo…"
                  onPress={() => {
                    setMenu(false);
                    setChanging(true);
                  }}
                />
              ) : null}
              <HideItem kind="artist" id={a.id} title={a.name} onClose={() => setMenu(false)} onHidden={backIfHere} divider={admin} />
            </Sheet>
          ) : null}
          {admin && a ? <ArtistPhotoSheet artist={changing ? a : null} onClose={() => setChanging(false)} /> : null}
        </>
      }
    >
      {body}
    </NestedScreen>
  );
}
