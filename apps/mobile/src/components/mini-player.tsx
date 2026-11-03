import { ActivityIndicator, Pressable, View } from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { chapterAt, timeLeft } from "@murmur/shared/client";
import { absolute, authHeaders } from "@/lib/api";
import { useAlbumColor } from "@/lib/data";
import { VideoView } from "expo-video";
import { openVideoPlayer } from "@/lib/watch";
import { useCast } from "@/player/cast";
import { type Playable, skipBy, toggle, trackStep, usePlayer, usePlayerSelect, usePositionSelect } from "@/player/engine";
import { closeVideo, skipVideo, toggleVideo, useVideo, useVideoHost, useVideoPositionSelect, useVideoSelect, videoPlayer } from "@/player/video";
import { fonts, mixColor, useTheme } from "@/theme";
import { Cover, useRetryOnFail } from "./cover";
import { CastIcon, CloseIcon, NextChapterIcon, PauseIcon, PlayIcon, PrevChapterIcon, SkipBackIcon, SkipForwardIcon } from "./icons";
import { Marquee } from "./marquee";
import { BarFill, BufferingRing } from "./player-controls";
import { Text } from "./ui";

/** Floating player above the tabs; tap to open the full player. */
export function MiniPlayer() {
  const t = useTheme();
  const { item, playing, loading, error, skip } = usePlayer();
  // Tinted with what's playing, like the web's Now playing card; eases over when the item changes.
  // A song takes its album's colour.
  const albumColor = useAlbumColor(item?.album?.id);
  const color = item?.color ?? albumColor;
  const surface = color ? mixColor(color, t.surface2, t.isDark ? 0.3 : 0.2) : t.surface2;
  // The grey sub line fades into a tinted light card; the darker text keeps it readable.
  const sub = t.isDark ? undefined : { color: t.text2 };
  const tint = useAnimatedStyle(() => ({ backgroundColor: withTiming(surface, { duration: 400 }) }));
  const castDevice = useCast().device;
  const backdrop = useRetryOnFail(item?.coverPath ?? null);
  const video = useVideoSelect((v) => !!v.item);
  if (video) return <VideoMiniPlayer />;
  if (!item) return null;
  const dur = item.durationSec || 0;
  const book = item.type === "book";
  // A song shows its artist and steps through the songs instead of skipping.
  const song = item.type === "track";

  return (
    <Animated.View
      style={[
        {
          marginHorizontal: 8,
          marginBottom: 6,
          borderRadius: 14,
          overflow: "hidden",
          elevation: 6,
          shadowColor: "#000",
          shadowOpacity: 0.3,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        },
        tint,
      ]}
    >
      {item.coverPath ? (
        // The cover blurred behind the card, so its colours bleed across it.
        <Image
          key={backdrop.count}
          onError={backdrop.failed}
          pointerEvents="none"
          source={{ uri: absolute(item.coverPath), headers: authHeaders(), cacheKey: item.coverPath }}
          cachePolicy="disk"
          blurRadius={40}
          contentFit="cover"
          // Larger than the card: Android caps the blur, so the image's own edges must stay hidden.
          style={{ position: "absolute", top: -60, bottom: -60, left: -60, right: -60, opacity: t.isDark ? 0.28 : 0.18 }}
        />
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 8, paddingRight: 4, minHeight: 64, paddingVertical: 6, gap: 4 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open player: ${item.title}`}
          onPress={() => router.push("/player")}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }}
        >
          <Cover path={item.coverPath} title={item.title} color={item.color} size={48} radius={8} />
          <View style={{ flex: 1, minWidth: 0 }}>
            {book ? (
              <Marquee>
                <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14 }}>
                  {item.title}
                </Text>
              </Marquee>
            ) : (
              <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14 }}>
                {item.title}
              </Text>
            )}
            {error ? (
              <Text variant="small" numberOfLines={2} style={{ color: t.danger }}>
                {error}
              </Text>
            ) : castDevice ? (
              <CastLine device={castDevice} />
            ) : book && item.chapters.length > 1 ? (
              // A book's chapter and time left share a line, which scrolls as one when it's long.
              // Tabular digits keep the time's width steady as it ticks, so the scroll runs on.
              <Marquee>
                <ChapterTitle item={item} style={sub} />
                {dur ? <TimeLeft dur={dur} style={[{ marginLeft: 14, fontVariant: ["tabular-nums"] }, sub]} /> : null}
              </Marquee>
            ) : dur && !song ? (
              <TimeLeft dur={dur} style={sub} />
            ) : (
              <Text variant="small" numberOfLines={1} style={sub}>
                {item.subtitle}
              </Text>
            )}
          </View>
        </Pressable>
        {song ? (
          <StepButton label="Previous song" onPress={() => trackStep(-1)}>
            <PrevChapterIcon size={26} color={t.text} />
          </StepButton>
        ) : (
          <SkipButton label={`Skip back ${skip.back} seconds`} seconds={skip.back} onPress={() => skipBy(-skip.back)}>
            <SkipBackIcon size={30} color={t.text} />
          </SkipButton>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? "Pause" : "Play"}
          onPress={toggle}
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
        >
          {loading ? (
            <ActivityIndicator color={t.text} />
          ) : playing ? (
            <PauseIcon size={26} color={t.text} />
          ) : (
            <PlayIcon size={26} color={t.text} />
          )}
        </Pressable>
        {song ? (
          <StepButton label="Next song" onPress={() => trackStep(1)}>
            <NextChapterIcon size={26} color={t.text} />
          </StepButton>
        ) : (
          <SkipButton label={`Skip forward ${skip.forward} seconds`} seconds={skip.forward} onPress={() => skipBy(skip.forward)}>
            <SkipForwardIcon size={30} color={t.text} />
          </SkipButton>
        )}
      </View>
      {/* A faint track under the fill, so early on (when the fill is tucked into the rounded
          corner) the bar still reads as progress. */}
      {dur ? <MiniBar fraction={usePositionFraction} dur={dur} /> : null}
    </Animated.View>
  );
}

// The ticking parts are their own components, so the card around them doesn't render twice a second.

type SubStyle = React.ComponentProps<typeof Text>["style"];

function ChapterTitle({ item, style }: { item: Playable; style: SubStyle }) {
  const title = usePositionSelect((at) => item.chapters[chapterAt(item.chapters, at)]?.title);
  return (
    <Text variant="small" numberOfLines={1} style={style}>
      {title}
    </Text>
  );
}

function TimeLeft({ dur, style }: { dur: number; style: SubStyle }) {
  const left = usePositionSelect((at) => timeLeft(dur, at));
  return (
    <Text variant="small" numberOfLines={1} style={style}>
      {left}
    </Text>
  );
}

function usePositionFraction(dur: number) {
  return usePositionSelect((at) => (dur ? Math.min(1, at / dur) : 0));
}

function useVideoFraction(dur: number) {
  return useVideoPositionSelect((at) => (dur ? Math.min(1, at / dur) : 0));
}

function MiniBar({ fraction, dur }: { fraction: (dur: number) => number; dur: number }) {
  const t = useTheme();
  const f = fraction(dur);
  return (
    <View style={{ height: 3 }}>
      <View style={{ position: "absolute", inset: 0, backgroundColor: t.muted, opacity: 0.18 }} />
      <BarFill fraction={f} color={t.accent} />
    </View>
  );
}

function SkipButton({ label, seconds, onPress, children }: { label: string; seconds: number; onPress: () => void; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
    >
      {children}
      <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 9, lineHeight: 10, includeFontPadding: false, color: t.text }}>{seconds}</Text>
      </View>
    </Pressable>
  );
}

/** The second line while casting: where it's playing, in accent. */
function CastLine({ device }: { device: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <CastIcon size={13} color={t.accent} connected />
      <Text variant="small" numberOfLines={1} style={{ color: t.accent, flexShrink: 1 }}>
        {device}
      </Text>
    </View>
  );
}

function StepButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
    >
      {children}
    </Pressable>
  );
}

/**
 * A video playing on outside its player: the picture where the cover goes, with skip back, play
 * and close. A tap opens the player again where it is.
 */
function VideoMiniPlayer() {
  const t = useTheme();
  const v = useVideo();
  const skip = usePlayerSelect((s) => s.skip);
  const host = useVideoHost();
  const castDevice = useCast().device;
  const it = v.item;
  if (!it) return null;
  const heading = it.kind === "episode" ? it.showTitle : it.title;
  return (
    <View
      style={{
        marginHorizontal: 8,
        marginBottom: 6,
        borderRadius: 14,
        overflow: "hidden",
        elevation: 6,
        shadowColor: "#000",
        shadowOpacity: 0.3,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        backgroundColor: t.surface2,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 8, paddingRight: 4, minHeight: 64, paddingVertical: 6, gap: 4 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open player: ${it.title}`}
          onPress={() => openVideoPlayer(it.target)}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }}
        >
          <View style={{ width: 85, height: 48, borderRadius: 8, overflow: "hidden", backgroundColor: "#000" }}>
            {/* The picture is on the TV while casting; here, its still or backdrop. */}
            {castDevice ? (
              it.castArt ? (
                <Image
                  source={{ uri: absolute(it.castArt), headers: authHeaders(), cacheKey: it.castArt }}
                  cachePolicy="disk"
                  contentFit="cover"
                  style={{ width: "100%", height: "100%" }}
                />
              ) : null
            ) : host ? (
              <VideoView player={videoPlayer()} nativeControls={false} surfaceType="textureView" contentFit="cover" style={{ width: "100%", height: "100%" }} />
            ) : null}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14 }}>
              {heading}
            </Text>
            {v.error ? (
              <Text variant="small" numberOfLines={2} style={{ color: t.danger }}>
                {v.error}
              </Text>
            ) : castDevice ? (
              <CastLine device={castDevice} />
            ) : (
              // A long version name gives way, so the time left always shows.
              <View style={{ flexDirection: "row" }}>
                {it.label ? (
                  <Text variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {`${it.label}, `}
                  </Text>
                ) : null}
                <VideoTimeLeft dur={it.durationSec} />
              </View>
            )}
          </View>
        </Pressable>
        <SkipButton label={`Skip back ${skip.back} seconds`} seconds={skip.back} onPress={() => skipVideo(-skip.back)}>
          <SkipBackIcon size={30} color={t.text} />
        </SkipButton>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={v.playing ? "Pause" : "Play"}
          onPress={toggleVideo}
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
        >
          {v.playing ? <PauseIcon size={26} color={t.text} /> : <PlayIcon size={26} color={t.text} />}
          <BufferingRing size={44} color={t.text} on={v.loading} />
        </Pressable>
        <StepButton label="Stop watching" onPress={closeVideo}>
          <CloseIcon size={22} color={t.text} />
        </StepButton>
      </View>
      <MiniBar fraction={useVideoFraction} dur={it.durationSec} />
    </View>
  );
}

function VideoTimeLeft({ dur }: { dur: number }) {
  const left = useVideoPositionSelect((at) => (dur ? timeLeft(dur, at) : ""));
  return (
    <Text variant="small" numberOfLines={1} style={{ fontVariant: ["tabular-nums"] }}>
      {left}
    </Text>
  );
}

/** The mini player at the bottom of screens outside the tabs (book, show, author). */
export function BottomMiniPlayer() {
  const insets = useSafeAreaInsets();
  const item = usePlayerSelect((s) => !!s.item);
  const video = useVideoSelect((v) => !!v.item);
  if (!item && !video) return null;
  return (
    <View style={{ paddingBottom: insets.bottom + 4, paddingTop: 4 }}>
      <MiniPlayer />
    </View>
  );
}
