import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { apiPaths, duration, type MovieDetail, pastStart, resolutionLabel, timeLeft, versionLabel, type VideoQuality, type WatchPoster } from "@murmur/shared/client";
import { CheckIcon, ChevronIcon, MoreIcon } from "@/components/icons";
import { PAD, Shelf, useShelfWidth } from "@/components/library";
import { BottomMiniPlayer } from "@/components/mini-player";
import { Empty, NestedFallback, SectionTitle, useBottomPad } from "@/components/page";
import { Card, Row } from "@/components/settings";
import { Sheet, SheetItem } from "@/components/sheet";
import { FadeIn } from "@/components/skeleton";
import { toast } from "@/components/toast";
import { IconButton, RoundButton, Text } from "@/components/ui";
import { FileDetails, PosterCard, QualityButton, startMovieDownload, VideoDownloadButton, WatchHero, WidePlayButton } from "@/components/watch";
import { WatchActions } from "@/components/watch-edit";
import { markWatched, openMovie, openVideoPlayer, useMovie } from "@/lib/watch";
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
      {/* Keyed, so moving to another film from its shelves starts fresh (version, description). */}
      <MovieView key={query.data.id} movie={query.data} />
    </FadeIn>
  );
}

/** A row of films on a movie's page: its collection, or ones like it. This film's title is in the accent. */
function MovieShelf({ title, items, current }: { title: string; items: WatchPoster[]; current: string }) {
  const width = useShelfWidth();
  return (
    <View>
      <SectionTitle title={title} />
      <Shelf>
        {items.map((p) => (
          <PosterCard key={p.id} item={p} width={width} current={p.id === current} onPress={() => p.id !== current && openMovie(p.id)} />
        ))}
      </Shelf>
    </View>
  );
}

/** A movie: poster, Play or Resume, Mark watched, the description, its versions, its shelves and the file. */
function MovieView({ movie }: { movie: MovieDetail }) {
  const t = useTheme();
  const bottomPad = useBottomPad();
  const [sheet, setSheet] = useState<null | "menu" | "version">(null);
  const [expanded, setExpanded] = useState(false);
  const [versionId, setVersionId] = useState(movie.versionList[0]!.id);
  /** A converted-video quality picked for this viewing; null means your setting. */
  const [quality, setQuality] = useState<VideoQuality | null>(null);
  const version = movie.versionList.find((v) => v.id === versionId) ?? movie.versionList[0]!;
  const finished = !!movie.progress?.finished;
  const position = movie.progress && !finished ? movie.progress.positionSec : 0;
  const started = pastStart(position);
  const posterPath = movie.posterHash ? apiPaths.movieArtUrl(movie.id, "poster", movie.posterHash) : null;
  const backdropPath = movie.backdropHash ? apiPaths.movieArtUrl(movie.id, "backdrop", movie.backdropHash) : null;
  // The blurred colour behind the header: the backdrop, else the poster, else a frame from the film.
  const art = backdropPath ?? posterPath ?? (version.stillHash ? apiPaths.videoStillUrl(version.id, version.stillHash, "small") : null);
  const pills = [movie.year, duration(version.durationSec), resolutionLabel(version.file.width, version.file.height)].filter((p): p is string => !!p);
  const playSub = started ? timeLeft(version.durationSec, position) : duration(version.durationSec);

  const mark = (done: boolean) => {
    markWatched([{ id: movie.id, durationSec: version.durationSec }], done);
    toast.show(done ? "Marked as watched" : "Marked as not watched");
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
            <IconButton label="More options" onPress={() => setSheet("menu")} style={{ marginRight: -10 }}>
              <MoreIcon color={t.text} />
            </IconButton>
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
          <VideoDownloadButton type="movie" id={movie.id} title={movie.title} round onDownload={() => void startMovieDownload(movie, versionId, quality)} />
          <RoundButton label={finished ? "Mark as not watched" : "Mark as watched"} active={finished} onPress={() => mark(!finished)}>
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

        {movie.collection?.items.length ? <MovieShelf title={movie.collection.name} items={movie.collection.items} current={movie.id} /> : null}
        {movie.similar?.length ? <MovieShelf title="More like this" items={movie.similar} current={movie.id} /> : null}

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
      <WatchActions kind="movie" id={movie.id} title={movie.title} open={sheet === "menu"} onClose={() => setSheet(null)} />
    </View>
  );
}
