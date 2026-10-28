import { memo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { apiPaths, duration, episodeLabel, plural, type ShowDetail, timeLeft, type VideoEpisode, type VideoQuality } from "@murmur/shared/client";
import { CheckIcon, MoreIcon, PlayedIcon } from "@/components/icons";
import { PAD } from "@/components/library";
import { BottomMiniPlayer } from "@/components/mini-player";
import { Empty, NestedFallback, SectionTitle, useBottomPad } from "@/components/page";
import { Sheet, SheetItem } from "@/components/sheet";
import { FadeIn } from "@/components/skeleton";
import { toast } from "@/components/toast";
import { Chips, IconButton, RoundButton, Text } from "@/components/ui";
import { ArtBar, QualityButton, Still, WatchHero, WatchMatchSheet, WidePlayButton } from "@/components/watch";
import { useSession } from "@/lib/session";
import { markWatched, openVideoPlayer, percentDone, seasonName, showEpisodes, useShow } from "@/lib/watch";
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

/** A show: poster, Resume on the next episode, a chip per season and its episodes. */
function ShowView({ show, askedSeason }: { show: ShowDetail; askedSeason: number | null }) {
  const t = useTheme();
  const bottomPad = useBottomPad();
  const admin = !!useSession().user?.isAdmin;
  const [sheet, setSheet] = useState<null | "menu" | "match">(null);
  const [expanded, setExpanded] = useState(false);
  /** A converted-video quality picked for this viewing; null means your setting. */
  const [quality, setQuality] = useState<VideoQuality | null>(null);
  const all = showEpisodes(show);
  const upNext = all.find((e) => e.id === show.upNextId) ?? null;
  // Opens on the season you're in, or the one asked for.
  const [season, setSeason] = useState(
    show.seasonList.some((s) => s.season === askedSeason) ? askedSeason! : (upNext?.season ?? show.seasonList[0]?.season ?? 1),
  );
  const episodes = show.seasonList.find((s) => s.season === season)?.episodes ?? [];
  const seasonDone = episodes.length > 0 && episodes.every((e) => e.progress?.finished);
  const posterPath = show.posterHash ? apiPaths.showArtUrl(show.id, "poster", show.posterHash) : null;
  const backdropPath = show.backdropHash ? apiPaths.showArtUrl(show.id, "backdrop", show.backdropHash) : null;
  const firstStill = all.find((e) => e.stillHash);
  // The blurred colour behind the header: the backdrop, else the poster, else a frame from an episode.
  const art = backdropPath ?? posterPath ?? (firstStill ? apiPaths.videoStillUrl(firstStill.id, firstStill.stillHash!, "small") : null);
  const pills = [show.year, plural(show.seasons, "season"), plural(show.episodes, "episode")].filter((p): p is string => !!p);
  const upNextPosition = upNext?.progress && !upNext.progress.finished ? upNext.progress.positionSec : 0;

  const mark = async (list: VideoEpisode[], done: boolean, what: string) => {
    try {
      await markWatched(
        list.map((e) => ({ id: e.id, durationSec: e.durationSec })),
        done,
      );
      toast.show(done ? `Marked ${what} as watched` : `Marked ${what} as not watched`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that.");
    }
  };

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
            admin ? (
              <IconButton label="More options" onPress={() => setSheet("menu")} style={{ marginRight: -10 }}>
                <MoreIcon color={t.text} />
              </IconButton>
            ) : null
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
            onPress={() => void mark(episodes, !seasonDone, seasonName(season))}
          >
            <CheckIcon size={22} color={seasonDone ? t.accent : t.text} />
          </RoundButton>
        </View>

        {show.description ? (
          <Pressable onPress={() => setExpanded((e) => !e)} style={{ marginTop: 18, gap: 4 }}>
            <Text numberOfLines={expanded ? undefined : 3}>{show.description}</Text>
            {show.description.length > 160 ? (
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
          <EpisodeRow key={e.id} e={e} onMark={(ep, done) => void mark([ep], done, episodeLabel(ep.season, ep.episode))} />
        ))}
      </ScrollView>

      <BottomMiniPlayer />
      <Sheet open={sheet === "menu"} onClose={() => setSheet(null)} title={show.title}>
        <SheetItem label="Match…" onPress={() => setSheet("match")} />
      </Sheet>
      <WatchMatchSheet open={sheet === "match"} onClose={() => setSheet(null)} kind="show" id={show.id} title={show.title} year={show.year} tmdbId={show.tmdbId} />
    </View>
  );
}

/** An episode: still with how far you are, number and title, time, and a watched toggle. */
const EpisodeRow = memo(function EpisodeRow({ e, onMark }: { e: VideoEpisode; onMark: (e: VideoEpisode, done: boolean) => void }) {
  const t = useTheme();
  const finished = !!e.progress?.finished;
  const position = e.progress && !finished ? e.progress.positionSec : 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Play ${e.episode}. ${e.title}`}
        onPress={() => openVideoPlayer({ kind: "episode", id: e.id, showId: e.showId })}
        style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.7 : 1 })}
      >
        <View style={{ width: 128, opacity: finished ? 0.6 : 1 }}>
          <Still videoId={e.id} hash={e.stillHash} title={e.title} width={128} />
          {position > 0 ? <ArtBar pct={percentDone(position, e.durationSec)} /> : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={2} style={{ fontSize: 14, color: finished ? t.muted : t.text }}>
            {`${e.episode}. ${e.title}`}
          </Text>
          <Text variant="small">{position > 0 ? timeLeft(e.durationSec, position) : duration(e.durationSec)}</Text>
        </View>
      </Pressable>
      <IconButton label={finished ? "Mark as not watched" : "Mark as watched"} accessibilityState={{ selected: finished }} onPress={() => onMark(e, !finished)} style={{ marginRight: -10 }}>
        <PlayedIcon played={finished} color={finished ? t.accent : t.muted} checkColor={t.onAccent} />
      </IconButton>
    </View>
  );
});
