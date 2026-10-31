import { memo, useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { apiPaths, episodeLabel, percentDone, plural, seasonName, type ShowDetail, type VideoEpisode, type VideoQuality } from "@murmur/shared/client";
import { CheckIcon, MoreIcon, PlayedIcon } from "@/components/icons";
import { PAD } from "@/components/library";
import { BottomMiniPlayer } from "@/components/mini-player";
import { Empty, NestedFallback, SectionTitle, useBottomPad } from "@/components/page";
import { SheetItem } from "@/components/sheet";
import { FadeIn } from "@/components/skeleton";
import { toast } from "@/components/toast";
import { Chips, IconButton, RoundButton, Text } from "@/components/ui";
import { ArtBar, QualityButton, startEpisodeDownload, Still, VideoDownloadButton, WatchHero, WidePlayButton } from "@/components/watch";
import { WatchActions } from "@/components/watch-edit";
import { useDownloads } from "@/lib/downloads";
import { useOnline } from "@/lib/query";
import { episodeSub, markWatched, openVideoPlayer, showEpisodes, useShow } from "@/lib/watch";
import { fonts, useTheme } from "@/theme";

export default function TvShowScreen() {
  const { id, season } = useLocalSearchParams<{ id: string; season?: string }>();
  const query = useShow(id);
  const [waited] = useState(!query.data);
  if (!query.data) {
    return <NestedFallback>{query.isError ? <Empty title="Couldn't load this show">{query.error.message}</Empty> : null}</NestedFallback>;
  }
  return (
    <FadeIn when={waited} style={{ flex: 1 }}>
      <ShowView show={query.data} askedSeason={season ? Number(season) : null} />
    </FadeIn>
  );
}

function mark(list: VideoEpisode[], done: boolean, what: string) {
  markWatched(
    list.map((e) => ({ id: e.id, durationSec: e.durationSec })),
    done,
  );
  toast.show(done ? `Marked ${what} as watched` : `Marked ${what} as not watched`);
}

const markEpisode = (e: VideoEpisode, done: boolean) => mark([e], done, episodeLabel(e.season, e.episode));

/** A show: poster, Resume on the next episode, a chip per season and its episodes. */
function ShowView({ show, askedSeason }: { show: ShowDetail; askedSeason: number | null }) {
  const t = useTheme();
  const bottomPad = useBottomPad();
  const [sheet, setSheet] = useState<null | "menu">(null);
  const [expanded, setExpanded] = useState(false);
  /** A converted-video quality picked for this viewing; null means your setting. */
  const [quality, setQuality] = useState<VideoQuality | null>(null);
  const online = useOnline();
  const downloads = useDownloads();
  const isSaved = (e: VideoEpisode) => downloads[`show:${e.id}`]?.status === "done";
  const all = showEpisodes(show);
  // Offline, Resume goes to the next downloaded episode from there.
  const upNextAt = all.findIndex((e) => e.id === show.upNextId);
  const upNext = (upNextAt < 0 ? null : online ? all[upNextAt] : all.slice(upNextAt).find(isSaved)) ?? null;
  // Opens on the season you're in, or the one asked for.
  const [season, setSeason] = useState(
    show.seasonList.some((s) => s.season === askedSeason) ? askedSeason! : (upNext?.season ?? show.seasonList[0]?.season ?? 1),
  );
  // Offline, only what's downloaded.
  const episodes = (show.seasonList.find((s) => s.season === season)?.episodes ?? []).filter((e) => online || isSaved(e));

  /** Every episode of the season not downloaded yet, one after another. */
  const downloadSeason = () => {
    setSheet(null);
    const todo = episodes.filter((e) => !downloads[`show:${e.id}`] || downloads[`show:${e.id}`]!.status === "error");
    if (!todo.length) {
      toast.show(`${seasonName(season)} is already downloaded`);
      return;
    }
    toast.show(`Downloading ${plural(todo.length, "episode")}`);
    void (async () => {
      for (const e of todo) await startEpisodeDownload(show, e, quality);
    })();
  };
  const seasonDone = episodes.length > 0 && episodes.every((e) => e.progress?.finished);
  const posterPath = show.posterHash ? apiPaths.showArtUrl(show.id, "poster", show.posterHash) : null;
  const backdropPath = show.backdropHash ? apiPaths.showArtUrl(show.id, "backdrop", show.backdropHash) : null;
  const firstStill = all.find((e) => e.stillHash);
  // The blurred colour behind the header: the backdrop, else the poster, else a frame from an episode.
  const art = backdropPath ?? posterPath ?? (firstStill ? apiPaths.videoStillUrl(firstStill.id, firstStill.stillHash!, "small") : null);
  const pills = [show.year, plural(show.seasons, "season"), plural(show.episodes, "episode")].filter((p): p is string => !!p);
  const upNextPosition = upNext?.progress && !upNext.progress.finished ? upNext.progress.positionSec : 0;

  // The same function between renders, so the memoised rows don't all redraw.
  const downloadEpisode = useCallback((ep: VideoEpisode) => void startEpisodeDownload(show, ep, quality), [show, quality]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: bottomPad }}>
        <WatchHero
          kind="show"
          id={show.id}
          title={show.title}
          posterHash={show.posterHash}
          color={show.color}
          art={art}
          pills={pills}
          right={
            <IconButton label="More options" onPress={() => setSheet("menu")} style={{ marginRight: -10 }}>
              <MoreIcon color={t.text} />
            </IconButton>
          }
        />

        <View style={{ flexDirection: "row", gap: 10, marginTop: 22 }}>
          {upNext ? (
            <WidePlayButton
              label={`${upNextPosition > 0 ? "Resume" : "Play"} ${episodeLabel(upNext.season, upNext.episode)}`}
              text={`${upNextPosition > 0 ? "Resume" : "Play"} ${episodeLabel(upNext.season, upNext.episode)}`}
              onPress={() => openVideoPlayer({ kind: "episode", id: upNext.id, showId: show.id, quality: quality ?? undefined })}
            />
          ) : (
            <WidePlayButton label="All watched" text="All watched" done onPress={() => undefined} />
          )}
          <QualityButton file={upNext?.file ?? null} value={quality} onChange={setQuality} />
          <RoundButton
            label={seasonDone ? `Mark ${seasonName(season)} as not watched` : `Mark ${seasonName(season)} as watched`}
            active={seasonDone}
            onPress={() => mark(episodes, !seasonDone, seasonName(season))}
          >
            <CheckIcon size={22} color={seasonDone ? t.accent : t.text} />
          </RoundButton>
        </View>

        {show.description ? (
          <Pressable onPress={() => setExpanded((e) => !e)} style={{ marginTop: 18, gap: 4 }}>
            <Text numberOfLines={expanded ? undefined : 3}>{show.description}</Text>
            {show.description.length > 220 ? (
              <Text variant="small" style={{ color: t.accent, fontFamily: fonts.bold }}>
                {expanded ? "Less" : "More"}
              </Text>
            ) : null}
          </Pressable>
        ) : null}

        {show.seasonList.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -PAD, marginTop: 24, marginBottom: 8 }} contentContainerStyle={{ paddingHorizontal: PAD }}>
            <Chips gap={8} label="Seasons" options={show.seasonList.map((s) => ({ id: s.season, label: seasonName(s.season) }))} value={season} onPick={setSeason} />
          </ScrollView>
        ) : (
          <SectionTitle title={seasonName(season)} />
        )}
        {episodes.map((e) => (
          <EpisodeRow key={e.id} e={e} quality={quality} onMark={markEpisode} onDownload={downloadEpisode} />
        ))}
      </ScrollView>

      <BottomMiniPlayer />
      <WatchActions
        kind="show"
        id={show.id}
        title={show.title}
        open={sheet === "menu"}
        onClose={() => setSheet(null)}
        extra={<SheetItem label="Download season" onPress={downloadSeason} />}
      />
    </View>
  );
}

/** An episode: still with how far you are, number and title, time, and a watched toggle. */
const EpisodeRow = memo(function EpisodeRow({
  e,
  quality,
  onMark,
  onDownload,
}: {
  e: VideoEpisode;
  /** The quality picked on the page, which Play passes on too. */
  quality: VideoQuality | null;
  onMark: (e: VideoEpisode, done: boolean) => void;
  onDownload: (e: VideoEpisode) => void;
}) {
  const t = useTheme();
  const finished = !!e.progress?.finished;
  const position = e.progress && !finished ? e.progress.positionSec : 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Play ${e.title}`}
        onPress={() => openVideoPlayer({ kind: "episode", id: e.id, showId: e.showId, quality: quality ?? undefined })}
        style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.7 : 1 })}
      >
        <View style={{ width: 128, opacity: finished ? 0.6 : 1 }}>
          <Still videoId={e.id} hash={e.stillHash} title={e.title} width={128} />
          {position > 0 ? <ArtBar pct={percentDone(position, e.durationSec)} /> : null}
        </View>
        {/* The text sits along the still's bottom edge. */}
        <View style={{ flex: 1, gap: 2, alignSelf: "stretch", justifyContent: "flex-end" }}>
          <Text variant="bodyStrong" numberOfLines={2} style={{ fontSize: 14, color: finished ? t.muted : t.text }}>
            {e.title}
          </Text>
          <Text variant="small">{episodeSub(e)}</Text>
        </View>
      </Pressable>
      <VideoDownloadButton type="show" id={e.id} title={e.title} onDownload={() => onDownload(e)} />
      <IconButton label={finished ? "Mark as not watched" : "Mark as watched"} accessibilityState={{ selected: finished }} onPress={() => onMark(e, !finished)} style={{ marginRight: -10 }}>
        <PlayedIcon played={finished} color={finished ? t.accent : t.muted} checkColor={t.onAccent} />
      </IconButton>
    </View>
  );
});
