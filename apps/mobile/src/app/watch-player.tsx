import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { isPictureInPictureSupported, VideoView } from "expo-video";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import Slider from "@react-native-community/slider";
import {
  clock,
  codecName,
  episodeLabel,
  type MovieDetail,
  QUALITY_LABEL,
  type ShowDetail,
  timeLeft,
  trackDetails,
  trackName,
  VIDEO_PLAYER,
  VIDEO_SPEEDS,
  type VideoEpisode,
  type VideoQuality,
} from "@murmur/shared/client";
import {
  AudioTrackIcon,
  CloseIcon,
  DownIcon,
  FullscreenIcon,
  MoreIcon,
  NextChapterIcon,
  PauseIcon,
  PipIcon,
  PlayIcon,
  PrevChapterIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "@/components/icons";
import { Pills } from "@/components/music";
import { Empty, NestedFallback, SectionTitle } from "@/components/page";
import { BufferingRing, SkipButton, Tile } from "@/components/player-controls";
import { Sheet, SheetItem } from "@/components/sheet";
import { toast } from "@/components/toast";
import { Button, Caption, IconButton, Text } from "@/components/ui";
import { QualitySheet, Still } from "@/components/watch";
import { useAutoplayNext } from "@/lib/data";
import { localVideo, useDownloads } from "@/lib/downloads";
import { useOnline } from "@/lib/query";
import { dragEndHaptic, tapHaptic } from "@/lib/haptics";
import {
  episodeSub,
  markWatched,
  openMovie,
  openTvShow,
  showEpisodes,
  useMovie,
  useShow,
  type WatchTarget,
} from "@/lib/watch";
import { usePlayerSelect } from "@/player/engine";
import {
  closeVideo,
  finishVideo,
  openVideo,
  seekVideo,
  setVideoQuality,
  setVideoSpeed,
  setVideoTrack,
  skipVideo,
  toggleVideo,
  useVideo,
  useVideoHost,
  useVideoTime,
  videoPlayer,
  type VideoItem,
} from "@/player/video";
import { fonts, mixColor, useTheme } from "@/theme";

/** How far a pull, or how fast a flick, minimises the player; the same as the audio player's. */
const CLOSE_DISTANCE = 120;
const CLOSE_VELOCITY = 900;

const speedLabel = (s: number) => `${s}x`;
const isQuality = (q: string | undefined): q is VideoQuality => q === "full" || q === "light";

function movieItem(movie: MovieDetail, versionId: string | undefined, quality: VideoQuality | null): VideoItem {
  const version = movie.versionList.find((v) => v.id === versionId) ?? movie.versionList[0]!;
  return {
    target: { kind: "movie", id: movie.id, ...(version.id === movie.versionList[0]!.id ? {} : { version: version.id }) },
    kind: "movie",
    progressId: movie.id,
    videoId: version.id,
    title: movie.title,
    showTitle: null,
    label: null,
    color: movie.color,
    file: version.file,
    durationSec: version.durationSec,
    startAt: movie.progress && !movie.progress.finished ? movie.progress.positionSec : 0,
    speedKey: movie.id,
    quality,
  };
}

function episodeItem(show: ShowDetail, e: VideoEpisode, quality: VideoQuality | null): VideoItem {
  return {
    target: { kind: "episode", id: e.id, showId: show.id },
    kind: "episode",
    progressId: e.id,
    videoId: e.id,
    title: e.title,
    showTitle: show.title,
    label: episodeLabel(e.season, e.episode),
    color: show.color,
    file: e.file,
    durationSec: e.durationSec,
    startAt: e.progress && !e.progress.finished ? e.progress.positionSec : 0,
    speedKey: show.id,
    quality,
  };
}

/** The video player for a movie (`v` picks a version) or an episode (`show` is its show); `q` is a quality picked for this viewing. */
export default function WatchPlayerScreen() {
  const params = useLocalSearchParams<{ kind: string; id: string; v?: string; show?: string; q?: string }>();
  const movie = useMovie(params.kind === "movie" ? params.id : undefined);
  const show = useShow(params.kind === "episode" ? params.show : undefined);
  const query = params.kind === "movie" ? movie : show;
  const current = useVideo().item;
  const quality = isQuality(params.q) ? params.q : null;
  const online = useOnline();
  useDownloads(); // The next episodes offline follow what's downloaded.

  // The video already on (opened from the mini player) shows at once, before anything loads.
  const target: WatchTarget | null =
    params.kind === "movie" ? { kind: "movie", id: params.id, version: params.v } : params.show ? { kind: "episode", id: params.id, showId: params.show } : null;
  const isCurrent = !!current && !!target && current.target.kind === target.kind && current.target.id === target.id;
  const fresh = useMemo(() => {
    if (params.kind === "movie") return movie.data ? movieItem(movie.data, params.v, quality) : null;
    const e = show.data && showEpisodes(show.data).find((x) => x.id === params.id);
    return show.data && e ? episodeItem(show.data, e, quality) : null;
  }, [params.kind, params.id, params.v, movie.data, show.data, quality]);
  const item = isCurrent ? current : fresh;

  if (!item) {
    return (
      <NestedFallback>
        {query.isError ? <Empty title="Couldn't load this video">{query.error.message}</Empty> : query.data ? <Empty title="This video isn't here any more" /> : null}
      </NestedFallback>
    );
  }
  return <Player item={item} next={show.data ? nextEpisodes(show.data, item.progressId, online) : []} show={show.data ?? null} />;
}

/** The episodes after this one; offline, only the downloaded ones. */
function nextEpisodes(show: ShowDetail, episodeId: string, online: boolean): VideoEpisode[] {
  const list = showEpisodes(show);
  const at = list.findIndex((e) => e.id === episodeId);
  return at < 0 ? [] : list.slice(at + 1).filter((e) => online || localVideo(e.id));
}

function Player({ item, next, show }: { item: VideoItem; next: VideoEpisode[]; show: ShowDetail | null }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const sideways = width > height;
  const v = useVideo();
  const skip = usePlayerSelect((s) => s.skip);
  const host = useVideoHost();
  const [view, setView] = useState<VideoView | null>(null);
  const [sheet, setSheet] = useState<null | "speed" | "audio" | "more" | "quality">(null);
  const [controls, setControls] = useState(true);
  const [pokedAt, setPokedAt] = useState(0);
  const [lastTap, setLastTap] = useState({ at: 0, x: 0 });
  /** Seconds the next-episode card has counted, for the episode it showed on. */
  const [ticks, setTicks] = useState({ id: "", n: 0 });
  /** The episode whose next-episode card was waved away. */
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const upNext = next[0] ?? null;
  const open = v.item?.progressId === item.progressId;
  const playing = open && v.playing;

  // Starts this video (or carries on with it, from the mini player).
  useEffect(() => {
    openVideo(item);
  }, [item]);

  // Only the player screen turns with the phone; the rest of the app stays upright.
  useEffect(() => {
    void ScreenOrientation.unlockAsync();
    return () => void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  }, []);

  // Full screen turns the picture sideways and holds it there until it's tapped again or you leave.
  const toggleFullscreen = () => {
    poke();
    void ScreenOrientation.lockAsync(sideways ? ScreenOrientation.OrientationLock.PORTRAIT_UP : ScreenOrientation.OrientationLock.LANDSCAPE);
  };

  // Sideways, the controls fade while playing and come back on a tap, which also restarts the wait.
  const poke = useCallback(() => {
    setControls(true);
    setPokedAt(Date.now());
  }, []);
  useEffect(() => {
    if (!sideways || !controls || !playing || sheet || scrub !== null) return;
    const timer = setTimeout(() => setControls(false), VIDEO_PLAYER.hideAfterMs);
    return () => clearTimeout(timer);
  }, [sideways, controls, playing, sheet, scrub, pokedAt]);

  const playEpisode = useCallback(
    (e: VideoEpisode) => {
      if (!show) return;
      openVideo(episodeItem(show, e, item.quality));
      router.setParams({ id: e.id });
    },
    [show, item.quality],
  );
  const goNext = useCallback(() => {
    if (upNext) playEpisode(upNext);
  }, [upNext, playEpisode]);

  // The next-episode card shows near the end and counts down while the video plays, then starts
  // the next one. Its count and dismissal belong to the episode, so the next one starts fresh.
  // With Play next episode off, the card still shows but nothing counts down or starts.
  const autoplay = useAutoplayNext();
  const { position, total } = useVideoTime();
  const shownAt = scrub ?? position;
  const left = Math.max(0, total - shownAt);
  const id = item.progressId;
  const isDismissed = dismissedId === id;
  const counted = ticks.id === id ? ticks.n : 0;
  const cardOn = open && !!upNext && !isDismissed && left > 0 && left <= VIDEO_PLAYER.nextCardAtSec;
  const countdown = cardOn && autoplay ? VIDEO_PLAYER.countdown - counted : null;
  useEffect(() => {
    if (countdown === null || !playing) return;
    const timer = setTimeout(() => (counted + 1 >= VIDEO_PLAYER.countdown ? goNext() : setTicks({ id, n: counted + 1 })), 1000);
    return () => clearTimeout(timer);
  }, [countdown, playing, counted, id, goNext]);
  useEffect(() => {
    if (autoplay && open && v.ended && upNext && !isDismissed) goNext();
  }, [autoplay, open, v.ended, upNext, isDismissed, goNext]);

  const keepWatching = () => setDismissedId(id);

  // A tap on the picture: double-tap either side skips; sideways, a single tap shows or hides the controls.
  const onStageTap = (x: number, boxWidth: number) => {
    if (countdown !== null) keepWatching();
    const now = Date.now();
    const frac = x / boxWidth;
    if (now - lastTap.at < VIDEO_PLAYER.doubleTapMs && Math.abs(frac - lastTap.x) < 0.2 && (frac < 0.35 || frac > 0.65)) {
      skipVideo(frac < 0.5 ? -skip.back : skip.forward);
      tapHaptic();
      poke();
      setLastTap({ at: 0, x: frac });
      return;
    }
    setLastTap({ at: now, x: frac });
    if (sideways) setControls((c) => !c);
  };

  const pip = () => {
    if (isPictureInPictureSupported()) void view?.startPictureInPicture().catch(() => undefined);
  };

  /** Leaves the player; the video carries on in the mini player. */
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/watch")), []);
  const stopWatching = () => {
    setSheet(null);
    closeVideo();
    back();
  };
  const goToPage = () => {
    setSheet(null);
    back();
    if (item.target.kind === "movie") openMovie(item.target.id);
    else openTvShow(item.target.showId);
  };
  const markDone = async () => {
    setSheet(null);
    try {
      await markWatched([{ id: item.progressId, durationSec: item.durationSec }], true);
      toast.show("Marked as watched");
      finishVideo();
      back();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that.");
    }
  };

  // Pulling the top row down minimises the player, as with the audio one.
  const pull = useSharedValue(0);
  const pullSpeed = useSharedValue(0);
  const pullDown = usePanGesture({
    activeOffsetY: 12,
    failOffsetX: [-24, 24],
    onUpdate: (e) => {
      pullSpeed.set(e.velocityY);
      pull.set(Math.max(0, e.translationY));
    },
    onFinalize: () => {
      const pulled = pull.get();
      if (pulled > CLOSE_DISTANCE || (pulled > 0 && pullSpeed.get() > CLOSE_VELOCITY)) {
        pull.set(withTiming(height, { duration: 200, easing: Easing.in(Easing.cubic) }, () => scheduleOnRN(back)));
      } else if (pulled > 0) {
        pull.set(withTiming(0, { duration: 180 }));
      }
    },
  });
  const pullStyle = useAnimatedStyle(() => ({ transform: [{ translateY: pull.value }] }));

  const heading = item.kind === "episode" ? item.showTitle : item.title;
  const subheading = item.kind === "episode" ? `${item.label}, ${item.title}` : null;
  const tracks = item.file.audioTracks;
  const tint = item.color ?? "#3b4a6e";
  const tintTop = mixColor(tint, t.bg, t.isDark ? 0.42 : 0.36);
  const tintBottom = mixColor(tint, t.bg, t.isDark ? 0.1 : 0.12);
  const light = sideways ? "#fff" : t.text;
  const soft = sideways ? "rgba(255,255,255,0.75)" : t.isDark ? t.muted : t.text2;
  const trackColor = sideways ? "rgba(255,255,255,0.35)" : t.isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)";

  const video = host ? (
    <VideoView
      ref={setView}
      player={videoPlayer()}
      nativeControls={false}
      // A texture, not a surface, so the picture clips to the rounded box like any view.
      surfaceType="textureView"
      contentFit="contain"
      allowsPictureInPicture
      startsPictureInPictureAutomatically
      style={StyleSheet.absoluteFill}
    />
  ) : null;

  const stage = (
    <Pressable
      accessibilityLabel="Video"
      onPress={(e) => onStageTap(e.nativeEvent.locationX, sideways ? width : width - 48)}
      style={StyleSheet.absoluteFill}
    />
  );

  const nextCard =
    cardOn && upNext ? (
      <View
        style={{
          position: "absolute",
          right: sideways ? Math.max(insets.right, 24) : 10,
          bottom: sideways ? 150 : 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          padding: 8,
          paddingRight: 2,
          borderRadius: 12,
          backgroundColor: "rgba(0,0,0,0.78)",
          maxWidth: 320,
        }}
      >
        <Pressable accessibilityRole="button" accessibilityLabel={`Play next: ${upNext.title}`} onPress={goNext} style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 }}>
          <Still videoId={upNext.id} hash={upNext.stillHash} title={upNext.title} width={sideways ? 96 : 72} radius={6} />
          <View style={{ flexShrink: 1 }}>
            <Caption style={{ color: "rgba(255,255,255,0.75)" }}>{countdown !== null ? `Next in ${countdown}` : "Next episode"}</Caption>
            <Text numberOfLines={2} style={{ fontFamily: fonts.bold, fontSize: 13, color: "#fff" }}>{upNext.title}</Text>
          </View>
        </Pressable>
        <IconButton label="Keep watching" onPress={keepWatching}>
          <CloseIcon size={20} color="#fff" />
        </IconButton>
      </View>
    ) : null;

  const scrubber = (
    <View>
      <Slider
        accessibilityLabel="Position"
        style={{ marginHorizontal: -12, height: 32 }}
        minimumValue={0}
        maximumValue={total || 1}
        value={Math.min(shownAt, total || 0)}
        minimumTrackTintColor={light}
        maximumTrackTintColor={trackColor}
        thumbTintColor={light}
        onSlidingStart={(to) => {
          tapHaptic();
          setScrub(to);
          poke();
        }}
        onValueChange={(to) => scrub !== null && setScrub(to)}
        // A spot the stream hasn't made yet starts a new one, so it waits for the release.
        onSlidingComplete={(to) => {
          dragEndHaptic();
          setScrub(null);
          seekVideo(to);
          poke();
        }}
      />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <Text variant="small" style={{ fontVariant: ["tabular-nums"], color: soft }}>
          {clock(shownAt)}
        </Text>
        {open && v.slow ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 }}>
            <Text variant="small" numberOfLines={1} style={{ color: soft, flexShrink: 1 }}>
              Converting slower than it plays
            </Text>
            {v.quality !== "light" ? (
              <Pressable accessibilityRole="button" onPress={() => setVideoQuality("light", true)} hitSlop={8}>
                <Text variant="small" style={{ color: t.accent, fontFamily: fonts.bold }}>
                  Lower quality
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : total ? (
          <Text variant="small" style={{ color: soft }}>
            {timeLeft(total, shownAt)}
          </Text>
        ) : null}
        <Text variant="small" style={{ fontVariant: ["tabular-nums"], color: soft }}>
          -{clock(left)}
        </Text>
      </View>
    </View>
  );

  const playSize = sideways ? 64 : 80;
  const controlRow = (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <IconButton label="Start over" onPress={() => seekVideo(0)}>
        <PrevChapterIcon color={sideways ? soft : t.muted} />
      </IconButton>
      <SkipButton seconds={skip.back} label={`Skip back ${skip.back} seconds`} color={light} onPress={() => (skipVideo(-skip.back), poke())}>
        <SkipBackIcon size={40} color={light} />
      </SkipButton>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? "Pause" : "Play"}
        disabled={!open}
        onPress={() => {
          toggleVideo();
          poke();
        }}
        style={({ pressed }) => ({
          width: playSize,
          height: playSize,
          borderRadius: playSize / 2,
          backgroundColor: t.accent,
          alignItems: "center",
          justifyContent: "center",
          opacity: !open ? 0.5 : pressed ? 0.85 : 1,
        })}
      >
        {playing ? <PauseIcon size={sideways ? 28 : 34} color={t.onAccent} /> : <PlayIcon size={sideways ? 28 : 34} color={t.onAccent} />}
        <BufferingRing size={playSize} color={t.onAccent} on={open && v.loading} />
      </Pressable>
      <SkipButton seconds={skip.forward} label={`Skip forward ${skip.forward} seconds`} color={light} onPress={() => (skipVideo(skip.forward), poke())}>
        <SkipForwardIcon size={40} color={light} />
      </SkipButton>
      <IconButton label="Next episode" onPress={goNext} disabled={!upNext}>
        <NextChapterIcon color={sideways ? soft : t.muted} />
      </IconButton>
    </View>
  );

  const sheets = (
    <>
      <Sheet open={sheet === "more"} onClose={() => setSheet(null)} title={item.title}>
        <SheetItem label={item.kind === "movie" ? "Go to movie" : "Go to show"} onPress={goToPage} />
        {open && v.plan === "transcode" ? <SheetItem label="Quality" value={QUALITY_LABEL[v.quality]} onPress={() => setSheet("quality")} /> : null}
        <SheetItem label="Mark as watched" onPress={() => void markDone()} />
        <SheetItem
          label="Start from the beginning"
          onPress={() => {
            setSheet(null);
            seekVideo(0);
          }}
        />
        <SheetItem label="Stop watching" danger onPress={stopWatching} />
      </Sheet>
      <QualitySheet
        open={sheet === "quality"}
        value={v.quality}
        onClose={() => setSheet(null)}
        onPick={(q) => {
          setSheet(null);
          setVideoQuality(q);
        }}
      />
      <Sheet open={sheet === "speed"} onClose={() => setSheet(null)} title="Speed">
        {VIDEO_SPEEDS.map((s) => (
          <SheetItem
            key={s}
            label={speedLabel(s)}
            active={s === v.speed}
            onPress={() => {
              setVideoSpeed(s);
              setSheet(null);
            }}
          />
        ))}
      </Sheet>
      <Sheet open={sheet === "audio"} onClose={() => setSheet(null)} title="Audio">
        {tracks.map((a) => (
          <SheetItem
            key={a.index}
            label={trackName(a)}
            value={trackDetails(a)}
            active={a.index === v.track}
            onPress={() => {
              setSheet(null);
              setVideoTrack(a.index);
            }}
          />
        ))}
      </Sheet>
      <Sheet open={open && !!v.error} onClose={stopWatching} title={v.error ?? ""}>
        <View style={{ paddingHorizontal: 12, gap: 14, paddingBottom: 8 }}>
          <Pills labels={[item.file.videoCodec ? codecName(item.file.videoCodec) : null, codecName(item.file.container)].filter((p): p is string => !!p)} />
          <Button label="Close" kind="secondary" onPress={stopWatching} />
        </View>
      </Sheet>
    </>
  );

  if (sideways) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <StatusBar hidden />
        {video}
        {stage}
        <FadeView shown={controls} style={StyleSheet.absoluteFill}>
          <LinearGradient pointerEvents="none" colors={["rgba(0,0,0,0.65)", "transparent"]} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 110 }} />
          <LinearGradient pointerEvents="none" colors={["transparent", "rgba(0,0,0,0.75)"]} style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 200 }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 12, paddingLeft: Math.max(insets.left, 16), paddingRight: Math.max(insets.right, 16) }}>
            <IconButton label="Close player" onPress={back}>
              <DownIcon color="#fff" />
            </IconButton>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.extrabold, fontSize: 16, color: "#fff" }}>
                {heading}
              </Text>
              {subheading ? (
                <Text numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
                  {subheading}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={{ position: "absolute", left: Math.max(insets.left, 24), right: Math.max(insets.right, 24), bottom: Math.max(insets.bottom, 12), gap: 4 }}>
            {scrubber}
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }} />
              <View style={{ width: 380 }}>{controlRow}</View>
              {/* What the tiles hold, at the bottom right of the picture. */}
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Speed ${speedLabel(v.speed)}`}
                  onPress={() => setSheet("speed")}
                  style={({ pressed }) => ({
                    height: 30,
                    paddingHorizontal: 10,
                    marginRight: 4,
                    borderRadius: 15,
                    borderWidth: 1.5,
                    borderColor: "rgba(255,255,255,0.45)",
                    justifyContent: "center",
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: "#fff", fontVariant: ["tabular-nums"] }}>{speedLabel(v.speed)}</Text>
                </Pressable>
                {tracks.length > 1 ? (
                  <IconButton label="Audio" onPress={() => setSheet("audio")}>
                    <AudioTrackIcon color="#fff" />
                  </IconButton>
                ) : null}
                <IconButton label="Picture in picture" onPress={pip}>
                  <PipIcon color="#fff" />
                </IconButton>
                <IconButton label="Exit full screen" onPress={toggleFullscreen}>
                  <FullscreenIcon exit color="#fff" />
                </IconButton>
              </View>
            </View>
          </View>
        </FadeView>
        {nextCard}
        {sheets}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Animated.View style={[{ flex: 1, backgroundColor: t.bg }, pullStyle]}>
        <LinearGradient colors={[tintTop, tintBottom]} style={StyleSheet.absoluteFill} />
        <View style={{ flex: 1, paddingTop: insets.top + 4, paddingBottom: insets.bottom + 16, paddingHorizontal: 24 }}>
          <GestureDetector gesture={pullDown}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: -10 }}>
              <IconButton label="Close player" onPress={back}>
                <DownIcon color={t.text} />
              </IconButton>
              <Caption style={{ letterSpacing: 0.6, color: soft }}>Playing from {item.kind === "movie" ? "Movies" : "Shows"}</Caption>
              <IconButton label="More options" onPress={() => setSheet("more")}>
                <MoreIcon color={t.text} />
              </IconButton>
            </View>
          </GestureDetector>

          <View
            style={{
              marginTop: 12,
              borderRadius: 16,
              elevation: 16,
              shadowColor: "#000",
              shadowOpacity: 0.45,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 16 },
              backgroundColor: "#000",
            }}
          >
            <View style={{ aspectRatio: 16 / 9, borderRadius: 16, overflow: "hidden", backgroundColor: "#000" }}>
              {video}
              {stage}
              {nextCard}
            </View>
          </View>

          <View style={{ gap: 2, marginTop: 20 }}>
            <Text variant="title" numberOfLines={2} style={{ fontSize: 22, lineHeight: 28 }}>
              {item.title}
            </Text>
            {item.kind === "episode" ? (
              <Text variant="small" numberOfLines={1} style={{ fontSize: 14, color: soft }}>{`${item.showTitle}, ${item.label}`}</Text>
            ) : null}
          </View>

          <View style={{ marginTop: 12, gap: 8 }}>
            {scrubber}
            {controlRow}
          </View>

          {/* The next episodes scroll in the space left, so the tiles stay at the bottom. */}
          <ScrollView style={{ flex: 1, marginTop: 8, marginHorizontal: -24 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 8 }}>
            {next.length ? (
              <>
                <SectionTitle title="Next episodes" />
                {next.slice(0, 10).map((e) => (
                  <Pressable
                    key={e.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Play ${e.title}`}
                    onPress={() => playEpisode(e)}
                    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6, opacity: pressed ? 0.7 : 1 })}
                  >
                    <Still videoId={e.id} hash={e.stillHash} title={e.title} width={112} />
                    <View style={{ flex: 1, gap: 2, alignSelf: "stretch", justifyContent: "flex-end" }}>
                      <Text variant="bodyStrong" numberOfLines={2} style={{ fontSize: 14 }}>
                        {e.title}
                      </Text>
                      <Text variant="small" style={{ color: soft }}>
                        {episodeSub(e)}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </>
            ) : null}
          </ScrollView>

          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <Tile label="Speed" onPress={() => setSheet("speed")} active={v.speed !== 1}>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 16, color: v.speed !== 1 ? t.accent : t.text }}>{speedLabel(v.speed)}</Text>
            </Tile>
            {tracks.length > 1 ? (
              <Tile label="Audio" onPress={() => setSheet("audio")}>
                <AudioTrackIcon size={20} color={t.text} />
              </Tile>
            ) : null}
            <Tile label="Pop out" onPress={pip}>
              <PipIcon size={20} color={t.text} />
            </Tile>
            <Tile label="Full screen" onPress={toggleFullscreen}>
              <FullscreenIcon size={20} color={t.text} />
            </Tile>
          </View>
        </View>
      </Animated.View>
      {sheets}
    </View>
  );
}

/** Fades its children in and out in place; hidden ones don't take taps. */
function FadeView({ shown, style, children }: { shown: boolean; style?: object; children: React.ReactNode }) {
  const fade = useAnimatedStyle(() => ({ opacity: withTiming(shown ? 1 : 0, { duration: 220 }) }));
  return (
    <Animated.View pointerEvents={shown ? "box-none" : "none"} style={[style, fade]}>
      {children}
    </Animated.View>
  );
}
