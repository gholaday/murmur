import { Component, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, type ScrollViewInstance, StyleSheet, useWindowDimensions, View, type ViewStyle } from "react-native";
import { router } from "expo-router";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { useQuery } from "@tanstack/react-query";
import {
  duration,
  localDay,
  ringPaths,
  ringToday,
  sparkPaths,
  STATS_KIND_LABEL,
  STATS_PERIOD_CHOICES,
  statsCompared,
  statsDayRows,
  type StatsDto,
  statsHeadline,
  type StatsKind,
  statsKindsShown,
  statsLines,
  type StatsPeriod,
  statsRing,
  statsRingNote,
  statsSinceLabel,
  statsSinceLine,
  statsSpark,
  statsSparkAxis,
  statsSum,
  type StatsTop,
  statsTopCover,
  statsTopItems,
  statsTopKind,
  statsTopTarget,
  statsTotalLabel,
  statsYears,
} from "@murmur/shared/client";
import { api } from "@/lib/api";
import { useTabPrefs } from "@/lib/data";
import { selectHaptic } from "@/lib/haptics";
import { fonts, type Theme, useTheme } from "@/theme";
import { Cover } from "./cover";
import { ChevronIcon } from "./icons";
import { PAD } from "./library";
import { Empty, SectionTitle } from "./page";
import { FadeIn, useJustLoaded } from "./skeleton";
import { Caption, Chips, Text } from "./ui";

// What the stats say (periods, labels, sentences, the line and the ring) comes from packages/shared, like the web's.

/** Books use the accent; the other kinds' colours match the web's --stat-2 to --stat-4. */
const STAT_COLORS = {
  dark: { episode: "#f2a65a", music: "#4fb39a", watch: "#e27fae" },
  light: { episode: "#b8620f", music: "#1e7a63", watch: "#b03a72" },
};
const kindColor = (t: Theme, k: StatsKind) => (k === "book" ? t.accent : STAT_COLORS[t.isDark ? "dark" : "light"][k]);

// The card on You pads its content by this much.
const CARD_PAD = 18;
const SPARK_HEIGHT = 64;
// Room around the line for its end dot, which can sit right at the edge.
const SPARK_BLEED = 6;
// The day labels under the line.
const AXIS_GAP = 6;
const AXIS_HEIGHT = 14;
const RING_MAX = 440;
const TOP_CARD = 124;
const TOP_GAP = 12;
const MONTHS: { label: string; style: ViewStyle }[] = [
  { label: "Jan", style: { alignItems: "center" } },
  { label: "Apr", style: { alignItems: "flex-end", justifyContent: "center" } },
  { label: "Jul", style: { alignItems: "center", justifyContent: "flex-end" } },
  { label: "Oct", style: { justifyContent: "center" } },
];

// A kind the server leaves out counts as nothing, not NaN.
const secOf = (split: Partial<Record<StatsKind, number>> | undefined, k: StatsKind) => statsSum(split, [k]);

/** Something in the stats failing to draw leaves a line saying so, not a crashed You tab. */
export class StatsBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("Stats failed to draw", err);
  }
  render() {
    return this.state.failed ? <Text variant="small">{"Couldn't load your stats."}</Text> : this.props.children;
  }
}

/** One period's stats. `year` asks for an earlier year. */
function useStats(period: StatsPeriod, year?: number) {
  // The device's own day and time zone, so "today" and "this week" are yours wherever the server is.
  const today = localDay();
  const tz = -new Date().getTimezoneOffset();
  return useQuery({
    queryKey: ["stats", period, today, year],
    queryFn: () => api<StatsDto>(`/api/stats?period=${period}&today=${today}&tz=${tz}${year ? `&year=${year}` : ""}`),
  });
}

/** The kinds the stats show: a hidden tab leaves its kind out. */
function useStatsKinds(): StatsKind[] {
  return statsKindsShown(useTabPrefs());
}

function useContentWidth() {
  return useWindowDimensions().width - PAD * 2;
}

/** The card on You: this week and a line of its days, opening Stats. */
export function StatsCard() {
  const t = useTheme();
  const kinds = useStatsKinds();
  const width = useContentWidth();
  const week = useStats("week");
  const s = week.data;
  const fade = useJustLoaded(!!s);
  if (week.isError && !s) return <Text variant="small">{"Couldn't load your stats."}</Text>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push("/stats")}
      style={({ pressed }) => ({ padding: CARD_PAD, borderRadius: 16, backgroundColor: t.surface, gap: 16, opacity: pressed ? 0.85 : 1 })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Caption>{statsTotalLabel(null, "week")}</Caption>
          <FadeIn when={fade} key={s ? "loaded" : "loading"} style={{ gap: 2 }}>
            <Total>{s ? duration(statsSum(s.split, kinds)) || "0m" : " "}</Total>
            <Text variant="small">{(s && statsCompared(s, kinds)) ?? " "}</Text>
          </FadeIn>
        </View>
        <ChevronIcon size={20} color={t.muted} />
      </View>
      {s ? (
        <FadeIn when={fade}>
          <Spark stats={s} kinds={kinds} today={localDay()} width={width - CARD_PAD * 2} dotEdge={t.surface} />
        </FadeIn>
      ) : (
        <View style={{ height: SPARK_HEIGHT + AXIS_GAP + AXIS_HEIGHT }} />
      )}
    </Pressable>
  );
}

function Total({ children }: { children: string }) {
  const t = useTheme();
  return <Text style={{ fontFamily: fonts.extrabold, fontSize: 34, lineHeight: 44, letterSpacing: -0.8, color: t.text }}>{children}</Text>;
}

/** The days of the period so far as one line, with a faint track for those to come. */
function Spark({ stats, kinds, today, width, dotEdge }: { stats: StatsDto; kinds: StatsKind[]; today: string; width: number; dotEdge: string }) {
  const t = useTheme();
  const { values, slots } = statsSpark(stats, kinds, today);
  const { line, area, x, y } = sparkPaths(values, slots, width, SPARK_HEIGHT);
  const fullWidth = width + SPARK_BLEED * 2;
  const fullHeight = SPARK_HEIGHT + SPARK_BLEED * 2;
  return (
    <View>
      <View accessible accessibilityRole="image" accessibilityLabel={`Time per day ${statsTotalLabel(null, stats.period).toLowerCase()}`} style={{ height: SPARK_HEIGHT }}>
        <Svg width={fullWidth} height={fullHeight} viewBox={`${-SPARK_BLEED} ${-SPARK_BLEED} ${fullWidth} ${fullHeight}`} style={{ margin: -SPARK_BLEED }}>
          {x < width - 8 ? <Line x1={x} y1={SPARK_HEIGHT - 2} x2={width - 4} y2={SPARK_HEIGHT - 2} stroke={t.track} strokeWidth={2} strokeLinecap="round" /> : null}
          <Path d={area} fill={t.accent} fillOpacity={0.12} />
          <Path d={line} fill="none" stroke={t.accent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx={x} cy={y} r={4.5} fill={t.accent} stroke={dotEdge} strokeWidth={2} />
        </Svg>
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height: AXIS_HEIGHT, marginTop: AXIS_GAP }}>
        {statsSparkAxis(stats, today).map((l) => (
          <Text
            key={l.text}
            numberOfLines={1}
            style={{
              position: "absolute",
              left: `${l.at * 100}%`,
              transform: [{ translateX: `${-l.at * 100}%` }],
              fontFamily: fonts.semibold,
              fontSize: 11,
              lineHeight: AXIS_HEIGHT,
              color: l.today ? t.text : t.muted,
            }}
          >
            {l.text}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Stats: sentences for a week or month, the ring for a year, and each year's ring for all time. */
export function StatsPage() {
  const kinds = useStatsKinds();
  const [period, setPeriod] = useState<StatsPeriod>("week");
  const query = useStats(period);
  const s = query.data;
  const today = localDay();
  if (s?.firstDay === null) return <Empty title="No plays yet">Play something and your stats start here.</Empty>;
  return (
    <>
      <Chips wrap options={STATS_PERIOD_CHOICES} value={period} onPick={setPeriod} label="Period" />
      {query.isError && !s ? (
        <Text variant="small" style={{ marginTop: 16 }}>
          {"Couldn't load your stats."}
        </Text>
      ) : null}
      {s ? (
        <FadeIn key={period} style={{ gap: 16, marginTop: 16 }}>
          {period === "year" ? (
            <YearView stats={s} kinds={kinds} today={today} />
          ) : period === "all" ? (
            <AllTimeView stats={s} kinds={kinds} today={today} />
          ) : (
            <SentencesView stats={s} kinds={kinds} today={today} />
          )}
        </FadeIn>
      ) : null}
    </>
  );
}

function Headline({ stats, kinds, sub }: { stats: StatsDto; kinds: StatsKind[]; sub: string | null }) {
  const t = useTheme();
  const { text, mostly, kind } = statsHeadline(stats, kinds);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 34, lineHeight: 41, letterSpacing: -0.8, color: t.text }}>
        {text}
        {mostly ? (
          <>
            , mostly <Text style={{ fontFamily: fonts.extrabold, fontSize: 34, lineHeight: 41, letterSpacing: -0.8, color: kind ? kindColor(t, kind) : t.text }}>{mostly}</Text>
          </>
        ) : null}
        .
      </Text>
      {sub ? <Text style={{ fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, color: t.muted }}>{sub}</Text> : null}
    </View>
  );
}

/** A week or month, or all time in your first year. */
function SentencesView({ stats, kinds, today }: { stats: StatsDto; kinds: StatsKind[]; today: string }) {
  const t = useTheme();
  const width = useContentWidth();
  const week = stats.period === "week";
  const days = week ? statsDayRows(stats, kinds, today) : [];
  const lines = week ? [] : statsLines(stats, kinds);
  return (
    <>
      <Headline stats={stats} kinds={kinds} sub={stats.period === "all" ? statsSinceLine(stats, today) : statsCompared(stats, kinds)} />
      {stats.period === "all" ? null : <Spark stats={stats} kinds={kinds} today={today} width={width} dotEdge={t.bg} />}
      {days.length ? (
        <View>
          {days.map((d) => (
            <Row key={d.day} top={d.top} style={{ height: 60 }}>
              <Text style={{ width: 42, fontFamily: fonts.bold, fontSize: 13, color: d.day === today ? t.accent : t.muted }}>{d.label}</Text>
              <Cover path={statsTopCover(d.top)} title={d.top.title} size={40} radius={6} />
              <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                {d.top.title}
              </Text>
              <Text variant="small">{d.time}</Text>
            </Row>
          ))}
        </View>
      ) : null}
      {lines.length ? (
        <View>
          {lines.map((l) => (
            <Row key={l.text} top={l.top} style={{ minHeight: 56, paddingVertical: 12 }}>
              {l.top ? <Cover path={statsTopCover(l.top)} title={l.top.title} size={48} radius={8} /> : null}
              <Text variant="bodyStrong" style={{ flex: 1, fontSize: 16, lineHeight: 22 }}>
                {l.text}
              </Text>
              {l.top ? <ChevronIcon size={20} color={t.muted} /> : null}
            </Row>
          ))}
        </View>
      ) : null}
      <TopItems stats={stats} picked={null} kinds={kinds} />
    </>
  );
}

/** A row in a list of days or sentences. It opens what it names; a line about no one thing opens nothing. */
function Row({ top, style, children }: { top: StatsTop | null; style: ViewStyle; children: React.ReactNode }) {
  const t = useTheme();
  const row: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, borderTopColor: t.line, ...style };
  if (!top) return <View style={row}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(topHref(top))} style={({ pressed }) => [row, { opacity: pressed ? 0.7 : 1 }]}>
      {children}
    </Pressable>
  );
}

function YearView({ stats, kinds, today }: { stats: StatsDto; kinds: StatsKind[]; today: string }) {
  const [focus, setFocus] = useState<StatsKind | null>(null);
  // A kind picked and then hidden falls back to all of them.
  const picked = focus && kinds.includes(focus) ? focus : null;
  const shown = picked ? [picked] : kinds;
  return (
    <>
      <Ring stats={stats} kinds={shown} today={today} year={Number(today.slice(0, 4))} eyebrow={statsTotalLabel(picked, "year")} note={statsRingNote(stats, shown, today)} />
      {kinds.length > 1 ? <Legend split={stats.split} kinds={kinds} picked={picked} onPick={(k) => setFocus(picked === k ? null : k)} /> : null}
      <TopItems stats={stats} picked={picked} kinds={kinds} />
    </>
  );
}

/** With two years or more, the total and a ring for the year picked; a first year has no years to pick. */
function AllTimeView({ stats, kinds, today }: { stats: StatsDto; kinds: StatsKind[]; today: string }) {
  const years = statsYears(stats, kinds);
  if (years.length < 2) return <SentencesView stats={stats} kinds={kinds} today={today} />;
  return <YearPicker stats={stats} kinds={kinds} today={today} years={years} />;
}

function YearPicker({ stats, kinds, today, years }: { stats: StatsDto; kinds: StatsKind[]; today: string; years: { year: number; sec: number }[] }) {
  const t = useTheme();
  const thisYear = Number(today.slice(0, 4));
  const [picked, setPicked] = useState(years[years.length - 1]!.year);
  const past = picked < thisYear ? picked : undefined;
  const query = useStats("year", picked);
  const year = query.data;
  const size = useRingSize();
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <Text style={{ fontFamily: fonts.extrabold, fontSize: 22, fontVariant: ["tabular-nums"], color: t.text }}>{duration(statsSum(stats.split, kinds)) || "0m"}</Text>
        <Text variant="small">{statsSinceLabel(stats.from)}</Text>
      </View>
      {year ? (
        <FadeIn key={picked}>
          <Ring stats={year} kinds={kinds} today={today} year={picked} eyebrow={String(picked)} note={statsRingNote(year, kinds, today, past)} />
        </FadeIn>
      ) : (
        <View style={{ width: size, height: size, alignSelf: "center", alignItems: "center", justifyContent: "center" }}>
          {query.isError ? <Text variant="small">{"Couldn't load this year."}</Text> : null}
        </View>
      )}
      <YearTiles years={years} picked={picked} onPick={setPicked} />
      {year ? <TopItems stats={year} picked={null} kinds={kinds} year={picked} /> : null}
    </>
  );
}

/** A tile per year, sharing the row; more than fit scroll sideways. It starts on the latest year, the last tile. */
function YearTiles({ years, picked, onPick }: { years: { year: number; sec: number }[]; picked: number; onPick: (year: number) => void }) {
  const t = useTheme();
  const strip = useRef<ScrollViewInstance>(null);
  return (
    <ScrollView
      ref={strip}
      horizontal
      accessibilityRole="radiogroup"
      accessibilityLabel="Year"
      showsHorizontalScrollIndicator={false}
      onContentSizeChange={() => strip.current?.scrollToEnd({ animated: false })}
      style={{ marginHorizontal: -PAD }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: PAD, gap: 8 }}
    >
      {years.map(({ year }) => {
        const selected = year === picked;
        return (
          <Pressable
            key={year}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => {
              if (selected) return;
              selectHaptic();
              onPick(year);
            }}
            style={{ flexGrow: 1, minWidth: 72, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: selected ? t.accent : t.surface }}
          >
            <Text style={{ fontFamily: selected ? fonts.bold : fonts.semibold, fontSize: 13, fontVariant: ["tabular-nums"], color: selected ? t.onAccent : t.text }}>{year}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function useRingSize() {
  return Math.min(useContentWidth(), RING_MAX);
}

/** Every day of a year around a ring: longer for more time, coloured by that week's main kind. */
function Ring({ stats, kinds, today, year, eyebrow, note }: { stats: StatsDto; kinds: StatsKind[]; today: string; year: number; eyebrow: string; note: string | null }) {
  const t = useTheme();
  const size = useRingSize();
  const ring = statsRing(year, stats.days, kinds);
  const { stubs, spokes } = ringPaths(ring, size);
  const now = ringToday(ring, today, size);
  return (
    <View style={{ width: size, height: size, alignSelf: "center" }}>
      <View accessible accessibilityRole="image" accessibilityLabel={`Every day of ${year} around a ring, longer for more time`}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Path d={stubs} fill="none" stroke={t.track} strokeWidth={2} strokeLinecap="round" />
          {kinds.map((k) => (spokes[k] ? <Path key={k} d={spokes[k]} fill="none" stroke={kindColor(t, k)} strokeWidth={2.2} strokeLinecap="round" /> : null))}
          {now ? <Line {...now} stroke={t.text} strokeWidth={2} strokeLinecap="round" /> : null}
        </Svg>
      </View>
      <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", gap: 2, pointerEvents: "none" }]}>
        <Caption>{eyebrow}</Caption>
        <Total>{duration(statsSum(stats.split, kinds)) || "0m"}</Total>
        {note ? (
          <Text variant="small" style={{ maxWidth: size * 0.5, textAlign: "center" }}>
            {note}
          </Text>
        ) : null}
      </View>
      {MONTHS.map((m) => (
        <View key={m.label} style={[StyleSheet.absoluteFill, { pointerEvents: "none" }, m.style]}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 11, color: t.muted }}>{m.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** The legend is also the filter: a kind picked is outlined in its colour, the others fade. */
function Legend({ split, kinds, picked, onPick }: { split: StatsDto["split"]; kinds: StatsKind[]; picked: StatsKind | null; onPick: (k: StatsKind) => void }) {
  const t = useTheme();
  return (
    <Grid columns={2} gap={8}>
      {kinds.map((k) => (
        <Pressable
          key={k}
          accessibilityRole="button"
          accessibilityState={{ selected: picked === k }}
          onPress={() => onPick(k)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            minHeight: 44,
            paddingHorizontal: 12,
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: picked === k ? kindColor(t, k) : "transparent",
            backgroundColor: picked === k ? t.surface2 : t.surface,
            opacity: picked && picked !== k ? 0.5 : 1,
          }}
        >
          <Dot color={kindColor(t, k)} />
          <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1, fontSize: 14 }}>
            {STATS_KIND_LABEL[k]}
          </Text>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 13, fontVariant: ["tabular-nums"], color: t.text2 }}>{duration(secOf(split, k)) || "0m"}</Text>
        </Pressable>
      ))}
    </Grid>
  );
}

/** All kinds: the lead of each, then the rest ranked. One kind: its top items. Scrolls sideways, mounting cards as they come near. */
function TopItems({ stats, picked, kinds, year }: { stats: StatsDto; picked: StatsKind | null; kinds: StatsKind[]; year?: number }) {
  const t = useTheme();
  const { title, items } = statsTopItems(stats, picked, kinds, year);
  if (!items.length) return null;
  return (
    // SectionTitle brings its own space above, in place of the view's gap.
    <View style={{ marginTop: -16 }}>
      <SectionTitle title={title} />
      <FlatList
        horizontal
        data={items}
        keyExtractor={({ top: x }) => `${x.kind}:${x.id}`}
        getItemLayout={(_, index) => ({ length: TOP_CARD, offset: PAD + index * (TOP_CARD + TOP_GAP), index })}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={3}
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -PAD }}
        contentContainerStyle={{ paddingHorizontal: PAD, gap: TOP_GAP }}
        renderItem={({ item: { top: x, sub, label } }) => (
          <Pressable accessibilityRole="button" accessibilityLabel={x.title} onPress={() => router.push(topHref(x))} style={{ width: TOP_CARD, gap: 2 }}>
            <Cover path={statsTopCover(x)} title={x.title} size={TOP_CARD} radius={8} style={{ marginBottom: 6 }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Dot color={kindColor(t, statsTopKind(x))} size={8} />
              <Text style={{ fontFamily: fonts.bold, fontSize: 11, lineHeight: 16, letterSpacing: 0.6, textTransform: "uppercase", color: t.muted }}>{label}</Text>
            </View>
            <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 13, lineHeight: 18 }}>
              {x.title}
            </Text>
            <Text variant="small" numberOfLines={1}>
              {sub}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

/** A song opens its album. */
function topHref(x: StatsTop): `/book/${string}` | `/show/${string}` | `/album/${string}` | `/movie/${string}` | `/tv/${string}` {
  const { kind, id } = statsTopTarget(x);
  switch (kind) {
    case "book":
      return `/book/${id}`;
    case "podcast":
      return `/show/${id}`;
    case "movie":
      return `/movie/${id}`;
    case "tvshow":
      return `/tv/${id}`;
    case "album":
      return `/album/${id}`;
  }
}

function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

/** Equal columns; a short last row keeps its cells the same width rather than stretching them. */
function Grid({ columns, gap, children }: { columns: number; gap: number; children: React.ReactNode[] }) {
  const cells = children.filter(Boolean);
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < cells.length; i += columns) rows.push(cells.slice(i, i + columns));
  return (
    <View style={{ gap }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", gap }}>
          {Array.from({ length: columns }, (_, c) => (
            <View key={c} style={{ flex: 1, minWidth: 0 }}>
              {row[c] ?? null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
