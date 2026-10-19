import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Slider from "@react-native-community/slider";
import { clock, duration, timeLeft } from "@murmur/shared/client";
import { Cover } from "@/components/cover";
import {
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
  SkipBackIcon,
  SkipForwardIcon,
} from "@/components/icons";
import { useTopInset } from "@/components/page";
import { Sheet, SheetItem } from "@/components/sheet";
import { toast } from "@/components/toast";
import { IconButton, Text } from "@/components/ui";
import {
  chapterAt,
  chapterStep,
  clampSpeed,
  markCurrent,
  MAX_SPEED,
  MIN_SPEED,
  seek,
  setSleep,
  setSpeed,
  skipBy,
  stop,
  toggle,
  usePlayer,
  usePosition,
  type SleepTimer,
} from "@/player/engine";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, mixColor, useTheme } from "@/theme";

const SPEED_STEP = 0.25;
const SLEEP_MINUTES = [5, 10, 15, 30, 45, 60, 90];

/** 1×, 1.25×, 1.5×, no trailing zeros. */
const speedText = (v: number) => `${Number(v.toFixed(2))}×`;

function sleepLabel(sleep: SleepTimer, now: number): string {
  if (sleep.mode === "timer") return clock(Math.max(0, (sleep.endsAt - now) / 1000));
  if (sleep.mode === "chapter") return "Chapter end";
  return "Sleep";
}

export default function Player() {
  const t = useTheme();
  const top = useTopInset(4);
  const insets = useSafeAreaInsets();
  const p = usePlayer();
  const position = usePosition();
  const [sheet, setSheet] = useState<null | "speed" | "sleep" | "chapters" | "more">(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [speedDraft, setSpeedDraft] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { item } = p;

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
  const tint = item.color ?? "#3b4a6e";
  const choose = (fn: () => void) => () => {
    fn();
    setSheet(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <LinearGradient
        colors={[mixColor(tint, t.bg, t.isDark ? 0.3 : 0.24), mixColor(tint, t.bg, 0.06)]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: top, paddingBottom: insets.bottom + 16, paddingHorizontal: 24 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: -10 }}>
          <IconButton label="Close player" onPress={() => router.back()}>
            <DownIcon color={t.text} />
          </IconButton>
          <Text variant="caption" style={{ fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase" }}>
            Playing from {item.type === "book" ? "Library" : "Podcasts"}
          </Text>
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
          </View>

          <View style={{ gap: 4 }}>
            {multiChapter ? (
              <Pressable onPress={() => setSheet("chapters")} hitSlop={6} style={{ alignSelf: "flex-start" }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: t.accent }}>
                  Chapter {ci + 1} of {item.chapters.length}
                </Text>
              </Pressable>
            ) : null}
            <Text variant="title" style={{ fontSize: 22 }} numberOfLines={2}>
              {item.title}
            </Text>
            <Text variant="small" numberOfLines={1} style={{ fontSize: 14 }}>
              {multiChapter && chapter ? chapter.title : item.subtitle}
            </Text>
          </View>

          <View>
            <Slider
              accessibilityLabel="Position"
              style={{ marginHorizontal: -12, height: 32 }}
              minimumValue={0}
              maximumValue={spanLen}
              value={within}
              minimumTrackTintColor={t.text}
              maximumTrackTintColor={t.isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.2)"}
              thumbTintColor={t.text}
              onSlidingStart={(v) => setScrub(span.start + v)}
              onValueChange={(v) => scrub !== null && setScrub(span.start + v)}
              onSlidingComplete={(v) => {
                seek(span.start + v);
                setScrub(null);
              }}
            />
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text variant="small" style={{ fontVariant: ["tabular-nums"] }}>
                {clock(within)}
              </Text>
              {item.durationSec ? (
                <Text variant="small">{timeLeft(item.durationSec, pos)}</Text>
              ) : null}
              <Text variant="small" style={{ fontVariant: ["tabular-nums"] }}>
                -{clock(spanLen - within)}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <IconButton label={multiChapter ? "Previous chapter" : "Back 30 seconds"} onPress={() => chapterStep(-1)}>
              <PrevChapterIcon color={t.muted} />
            </IconButton>
            <SkipButton seconds={p.skip.back} label={`Skip back ${p.skip.back} seconds`} onPress={() => skipBy(-p.skip.back)}>
              <SkipBackIcon size={40} color={t.text} />
            </SkipButton>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={p.playing ? "Pause" : "Play"}
              onPress={toggle}
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
            <SkipButton seconds={p.skip.forward} label={`Skip forward ${p.skip.forward} seconds`} onPress={() => skipBy(p.skip.forward)}>
              <SkipForwardIcon size={40} color={t.text} />
            </SkipButton>
            <IconButton label={multiChapter ? "Next chapter" : "Forward 30 seconds"} onPress={() => chapterStep(1)}>
              <NextChapterIcon color={t.muted} />
            </IconButton>
          </View>
          {p.error ? (
            <Text variant="small" style={{ color: t.danger, textAlign: "center" }}>
              {p.error}
            </Text>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <Tile label="Speed" onPress={() => setSheet("speed")} active={p.speed !== 1}>
            <Text style={{ fontFamily: fonts.extrabold, fontSize: 16, color: p.speed !== 1 ? t.accent : t.text }}>{speedText(p.speed)}</Text>
          </Tile>
          <Tile label={sleepLabel(p.sleep, now)} onPress={() => setSheet("sleep")} active={p.sleep.mode !== "off"}>
            <MoonIcon size={20} color={p.sleep.mode !== "off" ? t.accent : t.text} />
          </Tile>
          <Tile label="Chapters" onPress={() => setSheet("chapters")} disabled={!multiChapter}>
            <ListIcon size={20} color={t.text} />
          </Tile>
          <Tile
            label={p.queue.length ? `Up Next ${p.queue.length}` : "Up Next"}
            onPress={() => {
              router.back();
              router.navigate("/up-next");
            }}
          >
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
          label={`End of ${multiChapter ? "chapter" : item.type === "book" ? "book" : "episode"}`}
          active={p.sleep.mode === "chapter"}
          disabled={!(multiChapter && chapter) && !item.durationSec}
          onPress={choose(() => setSleep({ mode: "chapter", endSec: multiChapter && chapter ? chapter.endSec : item.durationSec }))}
        />
      </Sheet>

      <Sheet open={sheet === "chapters"} onClose={() => setSheet(null)} title="Chapters" scrollY={Math.max(0, ci - 2) * CHAPTER_ROW}>
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

      <Sheet open={sheet === "more"} onClose={() => setSheet(null)} title={item.title}>
        <SheetItem
          label={item.type === "book" ? "Go to book" : "Go to podcast"}
          onPress={() => {
            setSheet(null);
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
            setSheet(null);
            stop();
          }}
        />
      </Sheet>
    </View>
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

function Tile({ label, onPress, active, disabled, children }: { label: string; onPress: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
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
        backgroundColor: t.isDark ? (pressed ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.07)") : pressed ? "rgba(0,0,0,0.1)" : "rgba(0,0,0,0.05)",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      {children}
      <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 11, color: active ? t.accent : t.muted }}>
        {label}
      </Text>
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
