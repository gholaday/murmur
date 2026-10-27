import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiPaths, duration, localDay, plural, type StatsDto, type StatsPeriod } from "@murmur/shared/client";
import { api } from "@/lib/api";
import { useBooks, usePodcasts } from "@/lib/data";
import { fonts, mixColor, useTheme } from "@/theme";
import { Cover } from "./cover";
import { Eyebrow } from "./listening";
import { Bone, Skeleton } from "./skeleton";
import { Chip, Text } from "./ui";

const PERIODS: { id: StatsPeriod; label: string; last: string; this: string }[] = [
  { id: "week", label: "Week", last: "last week", this: "this week" },
  { id: "month", label: "Month", last: "last month", this: "this month" },
  { id: "year", label: "Year", last: "last year", this: "this year" },
  { id: "all", label: "All time", last: "", this: "all time" },
];

/** Podcasts' and music's shares of the split; books use the accent. */
const PODCAST_COLOR = { dark: "#f2a65a", light: "#c9731f" };
const MUSIC_COLOR = { dark: "#4fb39a", light: "#1e7a63" };

const BARS_HEIGHT = 96;

function useStats(period: StatsPeriod) {
  // The device's own day and time zone, so "today" and "this week" are yours wherever the server is.
  const today = localDay();
  const tz = -new Date().getTimezoneOffset();
  return useQuery({
    queryKey: ["stats", period, today],
    queryFn: () => api<StatsDto>(`/api/stats?period=${period}&today=${today}&tz=${tz}`),
    // Switching period keeps the last numbers up until the new ones arrive, rather than flashing empty.
    placeholderData: keepPreviousData,
  });
}

/** The You tab's listening stats: total and bars for a period, the split, tiles and most played. */
export function ListeningStats() {
  const t = useTheme();
  const [period, setPeriod] = useState<StatsPeriod>("week");
  const stats = useStats(period);
  const p = PERIODS.find((x) => x.id === period)!;
  const s = stats.data;

  return (
    <View style={{ gap: 14 }}>
      <Eyebrow>Listening</Eyebrow>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: -4 }}>
        {PERIODS.map((x) => (
          <Chip key={x.id} label={x.label} selected={x.id === period} onPress={() => setPeriod(x.id)} />
        ))}
      </View>

      <View style={{ padding: 18, borderRadius: 16, backgroundColor: t.surface, gap: 16 }}>
        {s ? (
          <>
            <View style={{ gap: 2 }}>
              <Text style={{ fontFamily: fonts.extrabold, fontSize: 34, lineHeight: 44, letterSpacing: -0.8, color: t.text }}>{duration(s.totalSec) || "0m"}</Text>
              {s.previousSec !== null && s.totalSec + s.previousSec > 0 ? <Text variant="small">{compare(s.totalSec, s.previousSec, p.last)}</Text> : null}
            </View>
            <Bars stats={s} />
            <SplitBar split={s.split} />
          </>
        ) : stats.isError ? (
          <Text variant="small">{"Couldn't load your listening."}</Text>
        ) : (
          <Skeleton style={{ gap: 16 }}>
            <Bone width={140} height={34} />
            <Bone height={BARS_HEIGHT + 20} />
            <Bone height={8} />
          </Skeleton>
        )}
      </View>

      {s ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <Tile value={plural(s.streakDays, "day")} label="Listening streak" />
          <Tile value={plural(s.finishedBooks, "book")} label={`Finished ${p.this}`} />
          <Tile value={plural(s.episodesPlayed, "episode")} label={`Played ${p.this}`} />
          {s.savedSec > 0 ? <Tile value={duration(s.savedSec)} label="Saved by playing faster" /> : null}
        </View>
      ) : null}

      {s?.top.length ? (
        <View style={{ marginTop: 12 }}>
          <Eyebrow>{`Most played ${p.this}`}</Eyebrow>
          {s.top.map((x) => (
            <Pressable
              key={`${x.kind}:${x.id}`}
              accessibilityRole="button"
              onPress={() => router.push(x.kind === "book" ? `/book/${x.id}` : `/show/${x.id}`)}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 68, borderBottomWidth: 1, borderBottomColor: t.line }}
            >
              <Cover
                path={x.coverHash ? (x.kind === "book" ? apiPaths.coverUrl(x.id, x.coverHash, 200) : apiPaths.podcastCoverUrl(x.id, x.coverHash, 200)) : null}
                title={x.title}
                size={44}
                radius={8}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 15 }}>
                  {x.title}
                </Text>
                <Text variant="small">{x.kind === "book" ? "Book" : "Podcast"}</Text>
              </View>
              <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: t.text2 }}>{duration(x.sec)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function compare(total: number, previous: number, last: string): string {
  const diff = total - previous;
  if (Math.abs(diff) < 60) return `About the same as ${last}`;
  return `${duration(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${last}`;
}

/** One bar per day (per month for a year, per year for all time); the current one is accent. */
function Bars({ stats }: { stats: StatsDto }) {
  const t = useTheme();
  const today = localDay();
  const current = stats.period === "year" ? today.slice(0, 7) : stats.period === "all" ? today.slice(0, 4) : today;
  const max = Math.max(1, ...stats.bars.map((b) => b.sec));
  const dense = stats.bars.length > 12;
  const months = stats.bars.length > 7 && !dense;
  const rest = mixColor(t.accent, t.surface, 0.32);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Listening per ${stats.period === "year" ? "month" : stats.period === "all" ? "year" : "day"}`}
      style={{ flexDirection: "row", alignItems: "flex-end", gap: dense ? 2 : months ? 4 : 8, height: BARS_HEIGHT + 22 }}
    >
      {stats.bars.map((b, i) => (
        <View key={b.key} style={{ flex: 1, alignItems: "center", gap: 6 }}>
          <View
            style={{
              // A lone bar (all time, in the first year) stays bar-shaped rather than filling the card.
              width: "100%",
              maxWidth: 56,
              height: b.sec > 0 ? Math.max(4, (b.sec / max) * BARS_HEIGHT) : 3,
              borderRadius: dense ? 2 : 6,
              backgroundColor: b.sec > 0 ? (b.key === current ? t.accent : rest) : t.track,
            }}
          />
          {/* A month's 30 bars only label each week's first day. */}
          <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: months ? 10 : 11, lineHeight: 16, color: t.muted, width: dense ? 24 : undefined, textAlign: "center" }}>
            {!dense || i % 7 === 0 ? b.label : ""}
          </Text>
        </View>
      ))}
    </View>
  );
}

function SplitBar({ split }: { split: StatsDto["split"] }) {
  const t = useTheme();
  const rows = [
    { label: "Books", sec: split.book, color: t.accent },
    { label: "Podcasts", sec: split.episode, color: t.isDark ? PODCAST_COLOR.dark : PODCAST_COLOR.light },
    // Music only shows once you've listened to some.
    ...(split.music > 0 ? [{ label: "Music", sec: split.music, color: t.isDark ? MUSIC_COLOR.dark : MUSIC_COLOR.light }] : []),
  ];
  const total = rows.reduce((sum, r) => sum + r.sec, 0);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", gap: 2, backgroundColor: total ? undefined : t.track }}>
        {rows.map((r) => (r.sec > 0 ? <View key={r.label} style={{ flex: r.sec, backgroundColor: r.color }} /> : null))}
      </View>
      <View style={{ gap: 8 }}>
        {rows.map((r) => (
          <View key={r.label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: r.color }} />
            <Text variant="bodyStrong" style={{ flex: 1, fontSize: 14 }}>
              {r.label}
            </Text>
            <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: t.text2 }}>{duration(r.sec) || "0m"}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** A number with a label under it, two to a row. */
function Tile({ value, label, sub }: { value: string; label: string; sub?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexGrow: 1, flexBasis: "40%", padding: 14, borderRadius: 14, backgroundColor: t.surface, gap: 4 }}>
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 22, lineHeight: 30, color: t.text }}>{value}</Text>
      <Text variant="small">{label}</Text>
      {sub ? <Text variant="small">{sub}</Text> : null}
    </View>
  );
}

/** Counts from lists the app already has: books (and how many finished) and shows (and new episodes). */
export function LibraryTiles({ podcasts: showPodcasts }: { podcasts: boolean }) {
  const books = useBooks().data;
  const shows = usePodcasts().data;
  if (!books && !shows) return null;
  const finished = books?.filter((b) => b.progress?.finished).length ?? 0;
  const fresh = shows?.reduce((sum, s) => sum + s.unplayedCount, 0) ?? 0;
  return (
    <View style={{ gap: 14, marginTop: 12 }}>
      <Eyebrow>Library</Eyebrow>
      <View style={{ flexDirection: "row", gap: 10, marginTop: -4 }}>
        {books ? <Tile value={String(books.length)} label={books.length === 1 ? "Book" : "Books"} sub={`${finished} finished`} /> : null}
        {showPodcasts && shows ? <Tile value={String(shows.length)} label={shows.length === 1 ? "Podcast" : "Podcasts"} sub={`${fresh} new`} /> : null}
      </View>
    </View>
  );
}
