import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View, type ViewInstance } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import Slider from "@react-native-community/slider";
import {
  bookFinished,
  type BookmarkDto,
  bookmarkNear,
  bookmarkSpot,
  chapterAt,
  clampSpeed,
  clock,
  duration,
  type EpisodeAdsDto,
  MAX_SPEED,
  MIN_SPEED,
  SLEEP_MINUTES,
  sleepLabel,
  showMarkPlayed,
  SPEED_STEP,
  speedText,
  thirdTile,
  timeLeft,
} from "@murmur/shared/client";
import { BookmarkNoteSheet, BookmarkRows } from "@/components/bookmarks";
import { Cover } from "@/components/cover";
import { HeroBackdrop } from "@/components/hero";
import { MarqueeText } from "@/components/marquee";
import {
  BookmarkIcon,
  CheckIcon,
  CloseIcon,
  DownIcon,
  ListIcon,
  MinusIcon,
  MoonIcon,
  MoreIcon,
  NextChapterIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  PrevChapterIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "@/components/icons";
import { Empty, useTopInset } from "@/components/page";
import { BarFill, CastButton, SkipButton, Tile } from "@/components/player-controls";
import { Sheet, SheetItem } from "@/components/sheet";
import { toast } from "@/components/toast";
import { MixerBars } from "@/components/mixer";
import { TextTabs } from "@/components/text-tabs";
import { Caption, Chips, CountPill, IconButton, Text } from "@/components/ui";
import { UpNextSheet } from "@/components/up-next";
import { newBookmark, useBookmarks } from "@/lib/bookmarks";
import { useAlbumColor } from "@/lib/data";
import { dragEndHaptic, selectHaptic, tapHaptic } from "@/lib/haptics";
import { AD_MODES, adBreak, adModeFor, adPrefsStore, setShowMode, useAdDetection, useAdPrefs, type AdMode } from "@/player/ad-prefs";
import { useCast } from "@/player/cast";
import {
  chapterStep,
  cycleRepeat,
  getPosition,
  goBack,
  jumpTo,
  markCurrent,
  play,
  type Playable,
  seek,
  setSleep,
  setSpeed,
  skipBy,
  stayHere,
  stop,
  toggle,
  toggleShuffle,
  trackStep,
  usePlayer,
  usePlayerSelect,
  usePositionSelect,
} from "@/player/engine";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, mixColor, useTheme } from "@/theme";

/** How far a pull, or how fast a flick, minimises the player; the same as a sheet's. */
const CLOSE_DISTANCE = 120;
const CLOSE_VELOCITY = 900;

// Ad marks, the same in light and dark like the web's --ad colours.
const AD = "#ef9f27";
const AD_HEARD = "#ba7517";
const ON_AD = "#412402";

export default function Player() {
  const t = useTheme();
  const item = usePlayerSelect((s) => s.item);

  // Nothing to show (e.g. playback was stopped): close.
  useEffect(() => {
    if (!item && router.canGoBack()) router.back();
  }, [item]);

  if (!item) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  return <PlayerScreen item={item} />;
}

/** The place on the bar while dragging, else in the item, run through `pick`; renders when the answer changes. */
const useBarPlace = <T,>(scrub: number | null, pick: (place: number) => T) => usePositionSelect((at) => pick(scrub ?? at));

function PlayerScreen({ item }: { item: Playable }) {
  const t = useTheme();
  const top = useTopInset(4);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const p = usePlayer();
  const cast = useCast();
  const adPrefs = useAdPrefs();
  const adDetection = useAdDetection();
  const [sheet, setSheet] = useState<null | "speed" | "sleep" | "chapters" | "bookmarks" | "ads" | "more" | "upnext">(null);
  const [chaptersTab, setChaptersTab] = useState<"chapters" | "bookmarks">("chapters");
  const [editingBookmark, setEditingBookmark] = useState<{ bookmark: BookmarkDto; isNew: boolean } | null>(null);
  const bookmarks = useBookmarks(item.type, item.id);
  const [scrub, setScrub] = useState<number | null>(null);
  const [speedDraft, setSpeedDraft] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [titleY, setTitleY] = useState(0);
  const titleRef = useRef<ViewInstance>(null);
  /** Where the seek thumb was on the last change, for the ticks it passes. */
  const scrubFrom = useRef(0);
  // A song plays at 1x with no chapters: previous and next step through the songs.
  const song = item.type === "track";
  const albumColor = useAlbumColor(item.album?.id);
  const ci = useBarPlace(scrub, (at) => chapterAt(item.chapters, at));
  const nearBookmark = useBarPlace(scrub, (at) => (song ? null : bookmarkNear(bookmarks, at)));
  // A book that played to its end waits there: nothing starts on its own, so it offers a replay.
  const ended = useBarPlace(scrub, (at) => bookFinished(item.type, item.durationSec, at, p.playing || p.loading));

  // Pulling down anywhere from the top bar to the bottom of the cover minimises the player: it
  // follows the finger, uncovering the screen below, and closes past a distance or on a flick.
  const pull = useSharedValue(0);
  const pullSpeed = useSharedValue(0);
  const close = () => router.back();
  const pullDown = usePanGesture({
    activeOffsetY: 12,
    failOffsetX: [-24, 24],
    // Down to where the title starts, just below the cover; the player fills the screen.
    hitSlop: { bottom: -(height - (titleY || height * 0.5)) },
    onUpdate: (e) => {
      pullSpeed.set(e.velocityY);
      pull.set(Math.max(0, e.translationY));
    },
    onFinalize: () => {
      const pulled = pull.get();
      if (pulled > CLOSE_DISTANCE || (pulled > 0 && pullSpeed.get() > CLOSE_VELOCITY)) {
        pull.set(withTiming(height, { duration: 200, easing: Easing.in(Easing.cubic) }, () => scheduleOnRN(close)));
      } else if (pulled > 0) {
        pull.set(withTiming(0, { duration: 180 }));
      }
    },
  });
  const pullStyle = useAnimatedStyle(() => ({ transform: [{ translateY: pull.value }] }));

  // The sleep countdown ticks once a second.
  useEffect(() => {
    if (p.sleep.mode !== "timer") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [p.sleep]);

  const chapter = item.chapters[ci];
  const multiChapter = item.chapters.length > 1;
  // An episode's chapters split the bar into segments over the whole episode; a book's bar spans
  // the current chapter, like Pocket Casts. Without chapters it's the whole item.
  const segmented = item.type === "episode" && multiChapter;
  const span =
    chapter && multiChapter && !segmented ? { start: chapter.startSec, end: chapter.endSec } : { start: 0, end: item.durationSec || 0 };
  const spanLen = Math.max(1, span.end - span.start);
  const within = (at: number) => Math.min(spanLen, Math.max(0, at - span.start));
  const speed = speedDraft ?? p.speed;
  const tint = item.color ?? albumColor ?? "#3b4a6e";
  // The page's tint, strongest at the top; the blurred cover fades into it a little lower down.
  const tintTop = mixColor(tint, t.bg, t.isDark ? 0.42 : 0.36);
  const tintBottom = mixColor(tint, t.bg, t.isDark ? 0.1 : 0.12);
  // Secondary text: muted grey fades into the tinted light page, so it's darker there.
  const soft = t.isDark ? t.muted : t.text2;
  // The blurred cover starts below the top bar, so "Playing from" and its buttons stay clear.
  const bleedTop = top + 48;
  const bleedBottom = top + 560;
  /** The page's tint at `y` from the top. */
  const tintAt = (y: number) => mixColor(tintBottom, tintTop, Math.min(1, y / height));
  // Not yet known (never online since installing): the episode's own ad times say so.
  const showAds = item.type === "episode" && (adDetection ?? !!p.ads?.enabled);
  const adMode = adModeFor(adPrefs, item.podcastId);
  const marks = showAds && adMode !== "off" && p.ads?.enabled ? p.ads.ads : [];
  /** Where a time falls on the bar, 0 to 1. */
  const frac = (sec: number) => Math.min(Math.max(sec - span.start, 0), spanLen) / spanLen;
  const trackColor = t.isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)";
  const showOverride: AdMode | null = item.podcastId ? (adPrefs.shows[item.podcastId] ?? null) : null;
  const slot = thirdTile(item.type, multiChapter);
  const adShort = AD_MODES.find((m) => m.id === adMode)?.short;
  const onBookmark = () =>
    setEditingBookmark(nearBookmark ? { bookmark: nearBookmark, isNew: false } : { bookmark: newBookmark(item, bookmarkSpot(getPosition(), p.playing, p.speed)), isNew: true });
  const jumpToBookmark = (b: BookmarkDto) => {
    setSheet(null);
    void jumpTo(b, b.positionSec);
  };
  const noBookmarks = <Empty title="No bookmarks yet">Tap the bookmark beside the title to save a spot.</Empty>;
  const dragging = scrub !== null;
  const choose = (fn: () => void) => () => {
    fn();
    setSheet(null);
  };

  return (
    <GestureDetector gesture={pullDown}>
    <Animated.View style={[{ flex: 1, backgroundColor: t.bg }, pullStyle]}>
      <LinearGradient colors={[tintTop, tintBottom]} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <HeroBackdrop
        path={item.coverPathLarge}
        color={tint}
        top={bleedTop}
        height={bleedBottom - bleedTop}
        strength={1.4}
        fadeFrom={tintAt(bleedTop)}
        fade={tintAt(bleedBottom)}
      />
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: top, paddingBottom: insets.bottom + 16, paddingHorizontal: 24 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: -10 }}>
          {/* As wide as the buttons on the right, so the line between stays centred. */}
          <View style={{ width: cast.available ? 88 : 44 }}>
            <IconButton label="Close player" onPress={() => router.back()}>
              <DownIcon color={t.text} />
            </IconButton>
          </View>
          <Caption numberOfLines={1} style={{ flex: 1, textAlign: "center", letterSpacing: 0.6, color: soft }}>
            {ended ? "Finished" : cast.device ? `Playing on ${cast.device}` : `Playing from ${song ? (p.upNext.source?.title ?? "Music") : item.type === "book" ? "Books" : "Podcasts"}`}
          </Caption>
          <View style={{ flexDirection: "row" }}>
            <CastButton color={t.text} />
            <IconButton label="More options" onPress={() => setSheet("more")}>
              <MoreIcon color={t.text} />
            </IconButton>
          </View>
        </View>

        <View style={{ flex: 1, justifyContent: "center", gap: 22, paddingVertical: 12 }}>
          <View
            style={{
              alignSelf: "center",
              width: "100%",
              maxWidth: 340,
              borderRadius: 16,
              elevation: 16,
              shadowColor: "#000",
              shadowOpacity: 0.45,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 16 },
            }}
          >
            <Cover path={item.coverPathLarge} title={item.title} color={item.color} radius={16} />
            {/* Over the artwork like a video player's skip button, so nothing below moves. Both can
                show at once, Mark played on top. */}
            <CoverPills item={item} scrub={scrub} marks={marks} />
          </View>

          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              {/* Fades into the page's tint where it sits, so it needs its place on the screen. */}
              <View ref={titleRef} style={{ flex: 1, minWidth: 0 }} onLayout={() => titleRef.current?.measureInWindow((_x, y) => setTitleY(y))}>
                <MarqueeText text={item.title} variant="title" style={{ fontSize: 22 }} />
              </View>
              {song ? null : (
                <IconButton
                  label={nearBookmark ? "Edit bookmark" : "Bookmark this spot"}
                  accessibilityState={{ selected: !!nearBookmark }}
                  onPress={onBookmark}
                  style={{ marginTop: -5, marginBottom: -11, marginRight: -10 }}
                >
                  <BookmarkIcon filled={!!nearBookmark} color={nearBookmark ? t.accent : t.text} />
                </IconButton>
              )}
            </View>
            <Text variant="small" numberOfLines={1} style={{ fontSize: 14, color: soft }}>
              {multiChapter && !segmented && chapter ? chapter.title : item.subtitle}
            </Text>
          </View>

          <View>
            <View>
            {segmented ? (
              <ChapterSegments chapters={item.chapters} current={ci} scrub={scrub} frac={frac} grow={dragging} marks={marks} />
            ) : (
              // The slider's own track would cover the ticks and can't show ads, so it draws see-through over this one.
              <View
                pointerEvents="none"
                style={{ position: "absolute", left: 0, right: 0, top: 14, height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: trackColor }}
              >
                <Fill scrub={scrub} from={span.start} to={span.start + spanLen} color={t.text} />
                <AdMarks marks={marks} scrub={scrub} frac={frac} />
              </View>
            )}
            {/* Over the bar and under the thumb, inset to the thumb's travel so one sits on its tick at either end. */}
            {bookmarks.length ? (
              <View pointerEvents="none" style={{ position: "absolute", left: 5, right: 5, top: 10, height: 12 }}>
                {bookmarks
                  .filter((b) => b.positionSec >= span.start && b.positionSec <= span.end)
                  .map((b) => (
                    <View key={b.id} style={{ position: "absolute", left: `${frac(b.positionSec) * 100}%`, marginLeft: -1, width: 3, height: 12, borderRadius: 2, backgroundColor: t.accent }} />
                  ))}
              </View>
            ) : null}
            <SeekSlider
              scrub={scrub}
              at={within}
              accessibilityLabel="Position"
              style={{ marginHorizontal: -12, height: 32 }}
              minimumValue={0}
              maximumValue={spanLen}
              minimumTrackTintColor="transparent"
              maximumTrackTintColor="transparent"
              thumbTintColor={t.text}
              onSlidingStart={(v) => {
                tapHaptic();
                scrubFrom.current = v;
                setScrub(span.start + v);
              }}
              onValueChange={(v) => {
                if (scrub === null) return;
                // A tick at each end, as the thumb crosses into or out of an ad, and at each chapter.
                const from = scrubFrom.current;
                const edges = [
                  0,
                  spanLen,
                  ...marks.flatMap((a) => [a.startSec - span.start, a.endSec - span.start]),
                  ...(segmented ? item.chapters.slice(1).map((c) => c.startSec) : []),
                ];
                if (edges.some((e) => (from < e && v >= e) || (from > e && v <= e))) selectHaptic();
                scrubFrom.current = v;
                setScrub(span.start + v);
              }}
              onSlidingComplete={(v) => {
                dragEndHaptic();
                seek(span.start + v);
                setScrub(null);
              }}
            />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <BarTime scrub={scrub} text={(at) => clock(within(at))} style={{ fontVariant: ["tabular-nums"], color: soft }} />
              {/* An episode's chapter takes the middle: the time left is already on the right. */}
              {segmented ? (
                chapter ? (
                  <Pressable accessibilityRole="button" accessibilityHint="Opens the chapters" onPress={() => setSheet("chapters")} hitSlop={6} style={{ flex: 1, paddingHorizontal: 10 }}>
                    {/* While dragging, the chapter under the thumb, in the accent. */}
                    <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 12, textAlign: "center", color: dragging ? t.accent : t.text }}>
                      {chapter.title}
                    </Text>
                  </Pressable>
                ) : null
              ) : item.durationSec && !song ? (
                <BarTime scrub={scrub} text={(at) => timeLeft(item.durationSec, at)} style={{ color: soft }} />
              ) : null}
              <BarTime scrub={scrub} text={(at) => `-${clock(spanLen - within(at))}`} style={{ fontVariant: ["tabular-nums"], color: soft }} />
            </View>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: ended ? "center" : "space-between" }}>
            {ended ? null : song ? (
              <>
                <IconButton label={p.repeat === "one" ? "Repeat song" : p.repeat === "all" ? "Repeat all" : "Repeat off"} onPress={cycleRepeat}>
                  {p.repeat === "one" ? <RepeatOneIcon color={t.accent} /> : <RepeatIcon color={p.repeat === "all" ? t.accent : t.muted} />}
                </IconButton>
                <IconButton label="Previous song" style={{ width: 56, height: 56 }} onPress={() => trackStep(-1)}>
                  <PrevChapterIcon size={36} color={t.text} />
                </IconButton>
              </>
            ) : (
              <>
                <IconButton label={multiChapter ? "Previous chapter" : item.type === "episode" ? "Previous" : "Back 30 seconds"} onPress={() => chapterStep(-1)}>
                  <PrevChapterIcon color={t.muted} />
                </IconButton>
                <SkipButton seconds={p.skip.back} label={`Skip back ${p.skip.back} seconds`} onPress={() => skipBy(-p.skip.back)}>
                  <SkipBackIcon size={40} color={t.text} />
                </SkipButton>
              </>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={ended ? "Play from the start" : p.playing ? "Pause" : "Play"}
              onPress={ended ? () => play(item, 0) : toggle}
              style={({ pressed }) => ({
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: t.accent,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.85 : 1,
              })}
            >
              {p.loading ? (
                <ActivityIndicator color={t.onAccent} size="large" />
              ) : p.playing ? (
                <PauseIcon size={34} color={t.onAccent} />
              ) : (
                <PlayIcon size={34} color={t.onAccent} />
              )}
            </Pressable>
            {ended ? null : song ? (
              <>
                <IconButton label="Next song" style={{ width: 56, height: 56 }} onPress={() => trackStep(1)}>
                  <NextChapterIcon size={36} color={t.text} />
                </IconButton>
                <IconButton label="Shuffle" accessibilityState={{ selected: p.shuffle }} onPress={toggleShuffle}>
                  <ShuffleIcon color={p.shuffle ? t.accent : t.muted} />
                </IconButton>
              </>
            ) : (
              <>
                <SkipButton seconds={p.skip.forward} label={`Skip forward ${p.skip.forward} seconds`} onPress={() => skipBy(p.skip.forward)}>
                  <SkipForwardIcon size={40} color={t.text} />
                </SkipButton>
                <IconButton label={multiChapter ? "Next chapter" : item.type === "episode" ? "Next" : "Forward 30 seconds"} onPress={() => chapterStep(1)}>
                  <NextChapterIcon color={t.muted} />
                </IconButton>
              </>
            )}
          </View>
          {p.error ? (
            <Text variant="small" style={{ color: t.danger, textAlign: "center" }}>
              {p.error}
            </Text>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          {song ? null : (
            <Tile label="Speed" onPress={() => setSheet("speed")} active={p.speed !== 1}>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 16, color: p.speed !== 1 ? t.accent : t.text }}>{speedText(p.speed)}</Text>
            </Tile>
          )}
          <Tile label={sleepLabel(p.sleep, now)} onPress={() => setSheet("sleep")} active={p.sleep.mode !== "off"}>
            <MoonIcon size={20} color={p.sleep.mode !== "off" ? t.accent : t.text} />
          </Tile>
          {slot === "chapters" ? (
            <Tile label="Chapters" onPress={() => setSheet("chapters")}>
              <ListIcon size={20} color={t.text} />
            </Tile>
          ) : slot === "bookmarks" ? (
            <Tile label="Bookmarks" onPress={() => setSheet("bookmarks")}>
              <BookmarkIcon size={20} color={t.text} />
            </Tile>
          ) : null}
          <Tile label="Queue" count={p.upNext.items.length - p.upNext.index - 1} onPress={() => setSheet("upnext")}>
            <QueueIcon size={20} color={t.text} />
          </Tile>
        </View>
      </ScrollView>

      {/* Floats over the artwork, under the top bar, so nothing moves when it appears. Outside the
          scroll so a short screen scrolled down to the tiles still shows it. */}
      {p.goBackTo !== null ? (
        <View pointerEvents="box-none" style={{ position: "absolute", top: top + 48, left: 16, right: 16, alignItems: "center" }}>
          <Animated.View
            entering={FadeIn.duration(150)}
            style={{
              width: "100%",
              maxWidth: 376,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingLeft: 20,
              paddingRight: 2,
              paddingVertical: 4,
              borderRadius: 14,
              backgroundColor: t.surface2,
              elevation: 8,
              shadowColor: "#000",
              shadowOpacity: 0.25,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
            }}
          >
            <Text style={{ flex: 1, fontFamily: fonts.medium, fontSize: 13, color: t.text }}>You were at {clock(p.goBackTo)}</Text>
            <Pressable accessibilityRole="button" onPress={goBack} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: t.accent }}>Go back</Text>
            </Pressable>
            <IconButton label="Stay here" onPress={stayHere} style={{ width: 44, height: 44 }}>
              <CloseIcon size={18} color={t.muted} />
            </IconButton>
          </Animated.View>
        </View>
      ) : null}

      <Sheet open={sheet === "speed"} onClose={() => setSheet(null)} title="Playback speed">
        <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 28, color: t.text }}>{speedText(speed)}</Text>
            {speed !== 1 ? (
              <Pressable onPress={() => setSpeed(1)} hitSlop={8}>
                <Text style={{ fontFamily: fonts.bold, color: t.accent }}>Reset</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <StepButton label={`Slower by ${SPEED_STEP}`} disabled={p.speed <= MIN_SPEED} onPress={() => setSpeed(clampSpeed(p.speed - SPEED_STEP))}>
              <MinusIcon size={20} color={t.text} />
            </StepButton>
            <Slider
              accessibilityLabel="Playback speed"
              style={{ flex: 1, height: 40 }}
              minimumValue={MIN_SPEED}
              maximumValue={MAX_SPEED}
              step={0.05}
              value={p.speed}
              minimumTrackTintColor={t.accent}
              maximumTrackTintColor={t.track}
              thumbTintColor={t.accent}
              onValueChange={(v) => setSpeedDraft(clampSpeed(v))}
              onSlidingComplete={(v) => {
                setSpeed(clampSpeed(v));
                setSpeedDraft(null);
              }}
            />
            <StepButton label={`Faster by ${SPEED_STEP}`} disabled={p.speed >= MAX_SPEED} onPress={() => setSpeed(clampSpeed(p.speed + SPEED_STEP))}>
              <PlusIcon size={20} color={t.text} />
            </StepButton>
          </View>
        </View>
      </Sheet>

      <Sheet open={sheet === "sleep"} onClose={() => setSheet(null)} title="Sleep timer">
        <SheetItem label="Off" active={p.sleep.mode === "off"} onPress={choose(() => setSleep({ mode: "off" }))} />
        {SLEEP_MINUTES.map((m) => (
          <SheetItem key={m} label={`${m} minutes`} onPress={choose(() => setSleep({ mode: "timer", endsAt: Date.now() + m * 60_000 }))} />
        ))}
        <SheetItem
          label={`End of ${song ? "song" : multiChapter ? "chapter" : item.type === "book" ? "book" : "episode"}`}
          active={p.sleep.mode === "chapter"}
          disabled={!(multiChapter && chapter) && !item.durationSec}
          onPress={choose(() => setSleep({ mode: "chapter", endSec: multiChapter && chapter ? chapter.endSec : item.durationSec }))}
        />
      </Sheet>

      <Sheet
        open={sheet === "chapters"}
        onClose={() => setSheet(null)}
        head={
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text variant="heading">{chaptersTab === "chapters" ? "Chapters" : "Bookmarks"}</Text>
              {chaptersTab === "chapters" || bookmarks.length ? <CountPill count={chaptersTab === "chapters" ? item.chapters.length : bookmarks.length} /> : null}
            </View>
            <TextTabs
              label="Chapters or bookmarks"
              options={[
                { id: "chapters" as const, label: "Chapters" },
                { id: "bookmarks" as const, label: "Bookmarks" },
              ]}
              value={chaptersTab}
              onPick={setChaptersTab}
            />
          </View>
        }
        keepInView={chaptersTab === "chapters" ? { top: ci * CHAPTER_ROW, height: CHAPTER_ROW } : undefined}
        tall
        noScrollbar
      >
        {chaptersTab === "bookmarks" ? (bookmarks.length ? <BookmarkRows bookmarks={bookmarks} onJump={jumpToBookmark} /> : noBookmarks) : null}
        {chaptersTab === "chapters" ? item.chapters.map((c, i) => (
          <Pressable
            key={c.index}
            accessibilityRole="button"
            onPress={choose(() => seek(c.startSec))}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              height: CHAPTER_ROW,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: pressed ? t.surface2 : "transparent",
            })}
          >
            <View style={{ width: 26 }}>
              {i === ci ? (
                <MixerBars playing={p.playing} color={t.accent} />
              ) : (
                <Text variant="small" style={{ color: t.muted }}>
                  {i + 1}
                </Text>
              )}
            </View>
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: i === ci ? fonts.bold : fonts.medium, color: i === ci ? t.accent : i < ci ? t.muted : t.text }}>
              {c.title}
            </Text>
            <Text variant="small" style={{ color: t.muted }}>
              {duration(c.endSec - c.startSec)}
            </Text>
          </Pressable>
        )) : null}
      </Sheet>

      <Sheet
        open={sheet === "bookmarks"}
        onClose={() => setSheet(null)}
        head={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text variant="heading">Bookmarks</Text>
            {bookmarks.length ? <CountPill count={bookmarks.length} /> : null}
          </View>
        }
      >
        {bookmarks.length ? <BookmarkRows bookmarks={bookmarks} onJump={jumpToBookmark} /> : noBookmarks}
      </Sheet>

      <BookmarkNoteSheet bookmark={editingBookmark?.bookmark ?? null} isNew={editingBookmark?.isNew} onClose={() => setEditingBookmark(null)} />

      <Sheet open={sheet === "ads"} onClose={() => setSheet(null)} title="Ads">
        <Text variant="small" style={{ paddingHorizontal: 12, marginTop: -4, marginBottom: 4 }}>
          This device only
        </Text>
        {AD_MODES.map((m) => (
          <SheetItem key={m.id} label={m.label} hint={m.hint} active={adPrefs.mode === m.id} onPress={() => adPrefsStore.set({ ...adPrefs, mode: m.id })} />
        ))}
        {item.podcastId ? (
          <View style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8, gap: 10 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {item.subtitle ?? "This podcast"}
            </Text>
            <Chips
              kind="radio"
              label="Ads for this podcast"
              gap={8}
              wrap
              options={[{ id: null as AdMode | null, label: "Default" }, ...AD_MODES]}
              value={showOverride}
              onPick={(id) => adPrefsStore.set(setShowMode(adPrefs, item.podcastId!, id))}
            />
          </View>
        ) : null}
      </Sheet>

      <Sheet open={sheet === "more"} onClose={() => setSheet(null)} title={item.title}>
        <MoreItems item={item} close={() => setSheet(null)} ads={showAds ? adShort : undefined} openAds={() => setSheet("ads")} />
      </Sheet>

      <UpNextSheet open={sheet === "upnext"} onClose={() => setSheet(null)} />
    </Animated.View>
    </GestureDetector>
  );
}

/** A pill in the cover's bottom-right corner for a timely tap: Skip ad, or Mark played. */
function CoverPill({ color, onPress, children }: { color: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Animated.View entering={FadeIn.duration(150)}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingLeft: 14,
          paddingRight: 12,
          paddingVertical: 6,
          borderRadius: 999,
          backgroundColor: color,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

type Span = { startSec: number; endSec: number };

// What moves with the playhead is in small components of its own, so a tick renders those and not
// the screen around them, with its blurred backdrop.

/** Mark played and Skip ad, when they apply. */
function CoverPills({ item, scrub, marks }: { item: Playable; scrub: number | null; marks: EpisodeAdsDto["ads"] }) {
  const t = useTheme();
  const showMark = useBarPlace(scrub, (at) => showMarkPlayed(item.type, item.durationSec, at));
  const adIndex = useBarPlace(scrub, (at) => marks.findIndex((a) => at >= a.startSec && at < a.endSec));
  // An ad that runs to the episode's end has nothing to skip to once it's over.
  const atEnd = useBarPlace(scrub, (at) => !!item.durationSec && item.durationSec - at < 1);
  const inAd = adIndex >= 0 ? adBreak(marks, adIndex) : null;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", right: 12, bottom: 12, gap: 8, alignItems: "flex-end" }}>
      {showMark ? (
        // Marking it played closes the player, as reaching the end does.
        <CoverPill
          color={t.accent}
          onPress={() => {
            markCurrent(true);
            toast.show("Marked as played");
          }}
        >
          <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: t.onAccent }}>Mark played</Text>
          <CheckIcon size={16} color={t.onAccent} />
        </CoverPill>
      ) : null}
      {inAd && !atEnd ? (
        <CoverPill color={AD} onPress={() => seek(inAd.endSec)}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: ON_AD }}>Skip ad</Text>
          <NextChapterIcon size={16} color={ON_AD} />
        </CoverPill>
      ) : null}
    </View>
  );
}

/** How much of `from` to `to` has played, filling its parent. */
function Fill({ scrub, from, to, color }: { scrub: number | null; from: number; to: number; color: string }) {
  const fraction = useBarPlace(scrub, (at) => Math.min(1, Math.max(0, (at - from) / (to - from || 1))));
  return <BarFill fraction={fraction} color={color} />;
}

function SeekSlider({ scrub, at, ...slider }: { scrub: number | null; at: (place: number) => number } & Omit<React.ComponentProps<typeof Slider>, "value">) {
  const value = useBarPlace(scrub, at);
  return <Slider value={value} {...slider} />;
}

function BarTime({ scrub, text, style }: { scrub: number | null; text: (place: number) => string; style: React.ComponentProps<typeof Text>["style"] }) {
  const shown = useBarPlace(scrub, text);
  return (
    <Text variant="small" style={style}>
      {shown}
    </Text>
  );
}

/** The ads on the bar, filling darker as they're heard. */
function AdMarks({ marks, scrub, frac }: { marks: Span[]; scrub: number | null; frac: (sec: number) => number }) {
  return marks.map((a) => {
    const left = frac(a.startSec);
    const width = frac(a.endSec) - left;
    if (width <= 0) return null;
    return (
      <View key={a.startSec} style={{ position: "absolute", top: 0, bottom: 0, left: `${left * 100}%`, width: `${width * 100}%`, minWidth: 2, backgroundColor: AD }}>
        <Fill scrub={scrub} from={a.startSec} to={a.endSec} color={AD_HEARD} />
      </View>
    );
  });
}

/**
 * An episode's bar, one segment per chapter with a small gap between: played ones solid, the
 * current one filling up, later ones faint. The current one thickens while dragging.
 */
function ChapterSegments({
  chapters,
  current,
  scrub,
  frac,
  grow,
  marks,
}: {
  chapters: Span[];
  current: number;
  scrub: number | null;
  frac: (sec: number) => number;
  grow: boolean;
  marks: Span[];
}) {
  const t = useTheme();
  return (
    // Square segments, with only the bar's two ends rounded; while dragging nothing is clipped, so
    // the thicker current segment shows.
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 14, height: 4, borderRadius: 2, overflow: grow ? "visible" : "hidden" }}>
      {chapters.map((c, i) => {
        const left = frac(c.startSec);
        return (
          <View
            key={c.startSec}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${left * 100}%`,
              width: `${(frac(c.endSec) - left) * 100}%`,
              paddingRight: i < chapters.length - 1 ? 3 : 0,
              transform: [{ scaleY: grow && i === current ? 2 : 1 }],
            }}
          >
            <View style={{ flex: 1 }}>
              <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: t.text, opacity: 0.18 }} />
              <Fill scrub={scrub} from={c.startSec} to={c.endSec} color={t.text} />
            </View>
          </View>
        );
      })}
      <AdMarks marks={marks} scrub={scrub} frac={frac} />
    </View>
  );
}

/** The More sheet, as the web's: go to it, mark it or start it over (not songs), or stop. */
function MoreItems({ item, close, ads, openAds }: { item: Playable; close: () => void; ads?: string; openAds: () => void }) {
  const song = item.type === "track";
  const choose = (fn: () => void) => () => {
    fn();
    close();
  };
  return (
    <>
      <SheetItem
        label={song ? "Go to album" : item.type === "book" ? "Go to book" : "Go to podcast"}
        disabled={song && !item.album}
        onPress={() => {
          close();
          router.back();
          if (song) {
            if (item.album) router.push(`/album/${item.album.id}`);
          } else if (item.type === "book") router.push(`/book/${item.id}`);
          else if (item.podcastId) router.push(`/show/${item.podcastId}`);
        }}
      />
      {song ? null : (
        <>
          <SheetItem
            label={item.type === "book" ? "Mark as finished" : "Mark played"}
            onPress={choose(() => {
              markCurrent(true);
              toast.show(item.type === "book" ? "Marked as finished" : "Marked as played");
            })}
          />
          <SheetItem label="Start from the beginning" onPress={choose(() => markCurrent(false))} />
          {ads ? <SheetItem label="Ads" value={ads} chevron onPress={openAds} /> : null}
        </>
      )}
      <SheetItem label="Stop playback" danger onPress={choose(stop)} />
    </>
  );
}

const CHAPTER_ROW = 50;


function StepButton({ label, disabled, onPress, children }: { label: string; disabled?: boolean; onPress: () => void; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? t.surface2 : t.chip,
        opacity: disabled ? 0.4 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}
