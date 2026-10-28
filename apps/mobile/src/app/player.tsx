import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Slider from "@react-native-community/slider";
import {
  chapterAt,
  clampSpeed,
  clock,
  duration,
  MAX_SPEED,
  MIN_SPEED,
  SLEEP_MINUTES,
  sleepLabel,
  SPEED_STEP,
  speedText,
  timeLeft,
} from "@murmur/shared/client";
import { Cover } from "@/components/cover";
import { HeroBackdrop } from "@/components/hero";
import {
  CheckIcon,
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
import { useTopInset } from "@/components/page";
import { Sheet, SheetItem } from "@/components/sheet";
import { toast } from "@/components/toast";
import { Caption, Chips, IconButton, NumberBadge, Text } from "@/components/ui";
import { UpNextSheet } from "@/components/up-next";
import { cachedAlbumColor } from "@/lib/data";
import { AD_MODES, adBreak, adModeFor, adPrefsStore, setShowMode, useAdDetection, useAdPrefs, type AdMode } from "@/player/ad-prefs";
import {
  chapterStep,
  cycleRepeat,
  markCurrent,
  play,
  type Playable,
  seek,
  setSleep,
  setSpeed,
  skipBy,
  stop,
  toggle,
  toggleShuffle,
  trackStep,
  usePlayer,
  usePosition,
} from "@/player/engine";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, mixColor, useTheme } from "@/theme";

// Ad marks, the same in light and dark like the web's --ad colours.
const AD = "#ef9f27";
const AD_HEARD = "#ba7517";
const ON_AD = "#412402";

export default function Player() {
  const t = useTheme();
  const top = useTopInset(4);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const p = usePlayer();
  const position = usePosition();
  const adPrefs = useAdPrefs();
  const adDetection = useAdDetection();
  const [sheet, setSheet] = useState<null | "speed" | "sleep" | "chapters" | "ads" | "more" | "upnext">(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [speedDraft, setSpeedDraft] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { item } = p;
  // A song plays at 1x with no chapters: previous and next step through the songs.
  const song = item?.type === "track";

  // The sleep countdown ticks once a second.
  useEffect(() => {
    if (p.sleep.mode !== "timer") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [p.sleep]);

  // Nothing to show (e.g. playback was stopped): close.
  useEffect(() => {
    if (!item && router.canGoBack()) router.back();
  }, [item]);

  if (!item) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  const pos = scrub ?? position;
  const ci = chapterAt(item.chapters, pos);
  const chapter = item.chapters[ci];
  const multiChapter = item.chapters.length > 1;
  // With chapters the bar spans the current chapter, like Pocket Casts; otherwise the whole item.
  const span = chapter && multiChapter ? { start: chapter.startSec, end: chapter.endSec } : { start: 0, end: item.durationSec || 0 };
  const spanLen = Math.max(1, span.end - span.start);
  const within = Math.min(spanLen, Math.max(0, pos - span.start));
  const speed = speedDraft ?? p.speed;
  const tint = item.color ?? (item.album ? cachedAlbumColor(item.album.id) : null) ?? "#3b4a6e";
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
  const adIndex = marks.findIndex((a) => pos >= a.startSec && pos < a.endSec);
  const inAd = adIndex >= 0 ? adBreak(marks, adIndex) : null;
  /** Where a time falls on the bar, 0 to 1. */
  const frac = (sec: number) => Math.min(Math.max(sec - span.start, 0), spanLen) / spanLen;
  const trackColor = t.isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)";
  const showOverride: AdMode | null = item.podcastId ? (adPrefs.shows[item.podcastId] ?? null) : null;
  const choose = (fn: () => void) => () => {
    fn();
    setSheet(null);
  };
  // A book that played to its end waits there: nothing starts on its own, so it offers a replay.
  const ended = item.type === "book" && !p.playing && !p.loading && item.durationSec > 0 && pos >= item.durationSec - 1;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
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
          <IconButton label="Close player" onPress={() => router.back()}>
            <DownIcon color={t.text} />
          </IconButton>
          <Caption style={{ letterSpacing: 0.6, color: soft }}>Playing from {song ? (p.upNext.source?.title ?? "Music") : item.type === "book" ? "Library" : "Podcasts"}</Caption>
          <IconButton label="More options" onPress={() => setSheet("more")}>
            <MoreIcon color={t.text} />
          </IconButton>
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
            {inAd ? (
              // Over the artwork like a video player's skip button, so nothing below moves.
              <Pressable
                accessibilityRole="button"
                onPress={() => seek(inAd.endSec)}
                style={({ pressed }) => ({
                  position: "absolute",
                  right: 12,
                  bottom: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  paddingLeft: 14,
                  paddingRight: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: AD,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: ON_AD }}>Skip ad</Text>
                <NextChapterIcon size={16} color={ON_AD} />
              </Pressable>
            ) : null}
          </View>

          <View style={{ gap: 4 }}>
            {ended ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <CheckIcon size={16} color={t.accent} />
                <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: t.accent }}>Finished</Text>
              </View>
            ) : multiChapter ? (
              <Pressable onPress={() => setSheet("chapters")} hitSlop={6} style={{ alignSelf: "flex-start" }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: t.accent }}>
                  Chapter {ci + 1} of {item.chapters.length}
                </Text>
              </Pressable>
            ) : null}
            <Text variant="title" style={{ fontSize: 22 }} numberOfLines={2}>
              {item.title}
            </Text>
            <Text variant="small" numberOfLines={1} style={{ fontSize: 14, color: soft }}>
              {multiChapter && chapter ? chapter.title : item.subtitle}
            </Text>
          </View>

          <View>
            <View>
            {marks.length ? (
              // The slider's own track can't show ads, so it draws see-through over this one.
              <View
                pointerEvents="none"
                style={{ position: "absolute", left: 0, right: 0, top: 14, height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: trackColor }}
              >
                <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${frac(pos) * 100}%`, backgroundColor: t.text }} />
                {marks.map((a) => {
                  const left = frac(a.startSec);
                  const width = frac(a.endSec) - left;
                  if (width <= 0) return null;
                  const heard = Math.min(1, Math.max(0, (pos - a.startSec) / (a.endSec - a.startSec)));
                  return (
                    <View
                      key={a.startSec}
                      style={{ position: "absolute", top: 0, bottom: 0, left: `${left * 100}%`, width: `${width * 100}%`, minWidth: 2, backgroundColor: AD }}
                    >
                      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${heard * 100}%`, backgroundColor: AD_HEARD }} />
                    </View>
                  );
                })}
              </View>
            ) : null}
            <Slider
              accessibilityLabel="Position"
              style={{ marginHorizontal: -12, height: 32 }}
              minimumValue={0}
              maximumValue={spanLen}
              value={within}
              minimumTrackTintColor={marks.length ? "transparent" : t.text}
              maximumTrackTintColor={marks.length ? "transparent" : trackColor}
              thumbTintColor={t.text}
              onSlidingStart={(v) => setScrub(span.start + v)}
              onValueChange={(v) => scrub !== null && setScrub(span.start + v)}
              onSlidingComplete={(v) => {
                seek(span.start + v);
                setScrub(null);
              }}
            />
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text variant="small" style={{ fontVariant: ["tabular-nums"], color: soft }}>
                {clock(within)}
              </Text>
              {item.durationSec && !song ? (
                <Text variant="small" style={{ color: soft }}>
                  {timeLeft(item.durationSec, pos)}
                </Text>
              ) : null}
              <Text variant="small" style={{ fontVariant: ["tabular-nums"], color: soft }}>
                -{clock(spanLen - within)}
              </Text>
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
                <IconButton label={multiChapter ? "Previous chapter" : "Back 30 seconds"} onPress={() => chapterStep(-1)}>
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
                <IconButton label={multiChapter ? "Next chapter" : "Forward 30 seconds"} onPress={() => chapterStep(1)}>
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
          {showAds ? (
            <Tile label="Ads" onPress={() => setSheet("ads")}>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 16, color: t.text }}>{AD_MODES.find((m) => m.id === adMode)?.short}</Text>
            </Tile>
          ) : song ? null : (
            <Tile label="Chapters" onPress={() => setSheet("chapters")} disabled={!multiChapter}>
              <ListIcon size={20} color={t.text} />
            </Tile>
          )}
          <Tile label="Up Next" count={p.upNext.items.length - p.upNext.index - 1} onPress={() => setSheet("upnext")}>
            <QueueIcon size={20} color={t.text} />
          </Tile>
        </View>
      </ScrollView>

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

      <Sheet open={sheet === "chapters"} onClose={() => setSheet(null)} title="Chapters" keepInView={{ top: ci * CHAPTER_ROW, height: CHAPTER_ROW }}>
        {item.chapters.map((c, i) => (
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
            <Text variant="small" style={{ width: 26, color: i === ci ? t.accent : t.muted }}>
              {i + 1}
            </Text>
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: i === ci ? fonts.bold : fonts.medium, color: i === ci ? t.accent : i < ci ? t.muted : t.text }}>
              {c.title}
            </Text>
            <Text variant="small">{duration(c.endSec - c.startSec)}</Text>
          </Pressable>
        ))}
      </Sheet>

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
              {item.subtitle ?? "This show"}
            </Text>
            <Chips
              kind="radio"
              label="Ads for this show"
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
        {song ? (
          <SheetItem
            label="Go to album"
            disabled={!item.album}
            onPress={() => {
              setSheet(null);
              router.back();
              if (item.album) router.push(`/album/${item.album.id}`);
            }}
          />
        ) : (
          <MoreItems item={item} close={() => setSheet(null)} />
        )}
      </Sheet>

      <UpNextSheet open={sheet === "upnext"} onClose={() => setSheet(null)} />
    </View>
  );
}

/** A book's or episode's More sheet: go to it, mark it, or stop. */
function MoreItems({ item, close }: { item: Playable; close: () => void }) {
  const choose = (fn: () => void) => () => {
    fn();
    close();
  };
  return (
    <>
        <SheetItem
          label={item.type === "book" ? "Go to book" : "Go to podcast"}
          onPress={() => {
            close();
            router.back();
            if (item.type === "book") router.push(`/book/${item.id}`);
            else if (item.podcastId) router.push(`/show/${item.podcastId}`);
          }}
        />
        <SheetItem label={item.type === "book" ? "Mark as finished" : "Mark played"} onPress={choose(() => {
            markCurrent(true);
            toast.show(item.type === "book" ? "Marked as finished" : "Marked as played");
          })} />
        <SheetItem
          label="Stop playback"
          danger
          onPress={() => {
            close();
            stop();
          }}
        />
    </>
  );
}

const CHAPTER_ROW = 50;

function SkipButton({ seconds, label, onPress, children }: { seconds: number; label: string; onPress: () => void; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ width: 56, height: 56, alignItems: "center", justifyContent: "center" }}>
      {children}
      <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 12, lineHeight: 13, includeFontPadding: false, color: t.text }}>{seconds}</Text>
      </View>
    </Pressable>
  );
}

function Tile({
  label,
  count,
  onPress,
  active,
  disabled,
  children,
}: {
  label: string;
  /** A grey count in the corner, e.g. how much is in Up Next. */
  count?: number;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count}` : label}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 64,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        // Frosted white in light mode: a grey wash disappears into the tinted page.
        backgroundColor: t.isDark ? (pressed ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.07)") : pressed ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.65)",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      {children}
      <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 11, color: active ? t.accent : t.isDark ? t.muted : t.text2 }}>
        {label}
      </Text>
      {count ? <NumberBadge value={count > 99 ? "99+" : count} style={{ position: "absolute", top: 6, right: 8 }} /> : null}
    </Pressable>
  );
}

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
