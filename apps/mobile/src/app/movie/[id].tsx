import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { apiPaths, duration, type MovieDetail, resolutionLabel, timeLeft, versionLabel, type VideoQuality } from "@murmur/shared/client";
import { CheckIcon, ChevronIcon, MoreIcon } from "@/components/icons";
import { PAD } from "@/components/library";
import { BottomMiniPlayer } from "@/components/mini-player";
import { Empty, NestedFallback, useBottomPad } from "@/components/page";
import { Card, Row } from "@/components/settings";
import { Sheet, SheetItem } from "@/components/sheet";
import { FadeIn } from "@/components/skeleton";
import { toast } from "@/components/toast";
import { IconButton, RoundButton, Text } from "@/components/ui";
import { FileDetails, QualityButton, WatchHero, WatchMatchSheet, WidePlayButton } from "@/components/watch";
import { useSession } from "@/lib/session";
import { markWatched, openVideoPlayer, useMovie } from "@/lib/watch";
import { fonts, useTheme } from "@/theme";

export default function MovieScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useMovie(id);
  const [waited] = useState(!query.data);
  if (!query.data) {
    return <NestedFallback>{query.isError ? <Empty title="Couldn't load this movie">{query.error.message}</Empty> : null}</NestedFallback>;
  }
  return (
    <FadeIn when={waited} style={{ flex: 1 }}>
      <MovieView movie={query.data} />
    </FadeIn>
  );
}

/** A movie: poster, Play or Resume, Mark watched, the description, its versions and the file. */
function MovieView({ movie }: { movie: MovieDetail }) {
  const t = useTheme();
  const bottomPad = useBottomPad();
  const admin = !!useSession().user?.isAdmin;
  const [sheet, setSheet] = useState<null | "menu" | "version" | "match">(null);
  const [expanded, setExpanded] = useState(false);
  const [versionId, setVersionId] = useState(movie.versionList[0]!.id);
  /** A converted-video quality picked for this viewing; null means your setting. */
  const [quality, setQuality] = useState<VideoQuality | null>(null);
  const version = movie.versionList.find((v) => v.id === versionId) ?? movie.versionList[0]!;
  const finished = !!movie.progress?.finished;
  const position = movie.progress && !finished ? movie.progress.positionSec : 0;
  const started = position > 5;
  const posterPath = movie.posterHash ? apiPaths.movieArtUrl(movie.id, "poster", movie.posterHash) : null;
  const backdropPath = movie.backdropHash ? apiPaths.movieArtUrl(movie.id, "backdrop", movie.backdropHash) : null;
  // The blurred colour behind the header: the backdrop, else the poster, else a frame from the film.
  const art = backdropPath ?? posterPath ?? (version.stillHash ? apiPaths.videoStillUrl(version.id, version.stillHash, "small") : null);
  const pills = [movie.year, duration(version.durationSec), resolutionLabel(version.file.width, version.file.height)].filter((p): p is string => !!p);
  const playSub = started ? timeLeft(version.durationSec, position) : duration(version.durationSec);

  const mark = async (done: boolean) => {
    try {
      await markWatched([{ id: movie.id, durationSec: version.durationSec }], done);
      toast.show(done ? "Marked as watched" : "Marked as not watched");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that.");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: bottomPad }}>
        <WatchHero
          kind="movie"
          id={movie.id}
          title={movie.title}
          posterHash={movie.posterHash}
          color={movie.color}
          art={art}
          pills={pills}
          right={
            admin ? (
              <IconButton label="More options" onPress={() => setSheet("menu")} style={{ marginRight: -10 }}>
                <MoreIcon color={t.text} />
              </IconButton>
            ) : null
          }
        />

        <View style={{ flexDirection: "row", gap: 10, marginTop: 22 }}>
          <WidePlayButton
            label={`${started ? "Resume" : "Play"}, ${playSub}`}
            text={playSub}
            onPress={() =>
              openVideoPlayer({
                kind: "movie",
                id: movie.id,
                version: versionId === movie.versionList[0]!.id ? undefined : versionId,
                quality: quality ?? undefined,
              })
            }
          />
          <QualityButton file={version.file} value={quality} onChange={setQuality} />
          <RoundButton label={finished ? "Mark as not watched" : "Mark as watched"} active={finished} onPress={() => void mark(!finished)}>
            <CheckIcon size={22} color={finished ? t.accent : t.text} />
          </RoundButton>
        </View>

        {movie.description ? (
          <Pressable onPress={() => setExpanded((e) => !e)} style={{ marginTop: 18, gap: 4 }}>
            <Text numberOfLines={expanded ? undefined : 4}>{movie.description}</Text>
            {movie.description.length > 220 ? (
              <Text variant="small" style={{ color: t.accent, fontFamily: fonts.bold }}>
                {expanded ? "Less" : "More"}
              </Text>
            ) : null}
          </Pressable>
        ) : null}

        {movie.versionList.length > 1 ? (
          <Pressable accessibilityRole="button" onPress={() => setSheet("version")} style={({ pressed }) => ({ marginTop: 18, opacity: pressed ? 0.7 : 1 })}>
            <Card>
              <Row title="Version" last>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}>
                  <Text variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {versionLabel(version)}
                  </Text>
                  <ChevronIcon size={18} color={t.faint} />
                </View>
              </Row>
            </Card>
          </Pressable>
        ) : null}

        <FileDetails file={version.file} />
      </ScrollView>

      <BottomMiniPlayer />
      <Sheet open={sheet === "version"} onClose={() => setSheet(null)} title="Version">
        {movie.versionList.map((v) => (
          <SheetItem
            key={v.id}
            label={versionLabel(v)}
            hint={duration(v.durationSec)}
            active={v.id === versionId}
            onPress={() => {
              setVersionId(v.id);
              setSheet(null);
            }}
          />
        ))}
      </Sheet>
      <Sheet open={sheet === "menu"} onClose={() => setSheet(null)} title={movie.title}>
        <SheetItem label="Match…" onPress={() => setSheet("match")} />
      </Sheet>
      <WatchMatchSheet
        open={sheet === "match"}
        onClose={() => setSheet(null)}
        kind="movie"
        id={movie.id}
        title={movie.title}
        year={movie.year}
        tmdbId={movie.tmdbId}
      />
    </View>
  );
}
