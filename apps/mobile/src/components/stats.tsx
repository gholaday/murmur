import { Component, useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  apiPaths,
  dailyAverage,
  duration,
  localDay,
  plural,
  type StatsDto,
  type StatsKind,
  type StatsPeriod,
  type StatsTop,
  statsTopKind,
} from "@murmur/shared/client";
import { api } from "@/lib/api";
import { useBooks, useMusicSummary, usePodcasts, useTabPrefs } from "@/lib/data";
import { useMovies, useShows, useWatchHome } from "@/lib/watch";
import { fonts, type Theme, useTheme } from "@/theme";
import { Cover } from "./cover";
import { SectionTitle } from "./page";
import { Bone, Skeleton } from "./skeleton";
import { Caption, Chips, Text } from "./ui";

const PERIODS: { id: StatsPeriod; label: string; last: string; this: string }[] = [
  { id: "week", label: "Week", last: "last week", this: "This week" },
  { id: "month", label: "Month", last: "last month", this: "This month" },
  { id: "year", label: "Year", last: "last year", this: "This year" },
  { id: "all", label: "All time", last: "", this: "All time" },
];

const KIND_LABEL: Record<StatsKind, string> = { book: "Books", episode: "Podcasts", music: "Music", watch: "Watch" };
const TOP_LABEL: Record<StatsTop["kind"], string> = { book: "Book", podcast: "Podcast", album: "Album", song: "Song", movie: "Movie", tvshow: "Show" };

/** Books use the accent; the other kinds' colours match the web's --stat-2 to --stat-4. */
const STAT_COLORS = {
  dark: { episode: "#f2a65a", music: "#4fb39a", watch: "#e27fae" },
  light: { episode: "#b8620f", music: "#1e7a63", watch: "#b03a72" },
};
const kindColor = (t: Theme, k: StatsKind) => (k === "book" ? t.accent : STAT_COLORS[t.isDark ? "dark" : "light"][k]);

const BARS_HEIGHT = 112;

// A kind the server leaves out counts as nothing, not NaN.
const secOf = (split: Partial<Record<StatsKind, number>> | undefined, k: StatsKind) => split?.[k] ?? 0;
const sumOf = (split: Partial<Record<StatsKind, number>> | undefined, kinds: StatsKind[]) => kinds.reduce((s, k) => s + secOf(split, k), 0);

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

/** The kinds the stats show: a hidden tab, or a server with no music or videos, leaves its kind out. */
function useStatsKinds(): StatsKind[] {
  const tabs = useTabPrefs();
  const music = !!useMusicSummary().data?.enabled;
  const watch = !!useWatchHome().data?.enabled;
  return [
    "book",
    ...(tabs.podcasts ? (["episode"] as const) : []),
    ...(tabs.music && music ? (["music"] as const) : []),
    ...(tabs.watch !== false && watch ? (["watch"] as const) : []),
  ];
}

/** The total compared with the same stretch of the period before. */
function change(now: number, before: number | null, last: string): string | null {
  if (before === null || now + before === 0) return null;
  const diff = now - before;
  if (Math.abs(diff) < 60) return `About the same as ${last}`;
  return `${duration(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${last}`;
}

/** The bar for today, or the month or year it's in. */
function currentKey(period: StatsPeriod, today: string): string {
  if (period === "year") return today.slice(0, 7);
  if (period === "all") return today.slice(0, 4);
  return today;
}

/**
 * The You tab's stats: the time for a period with a chart stacked by kind, a legend that picks one
 * kind, tiles and the top items. A hidden kind leaves all of it, the total included.
 */
export function ListeningStats() {
  const t = useTheme();
  const kinds = useStatsKinds();
  const [period, setPeriod] = useState<StatsPeriod>("week");
  const [focus, setFocus] = useState<StatsKind | null>(null);
  const stats = useStats(period);
  const s = stats.data;
  const today = localDay();
  const p = PERIODS.find((x) => x.id === period)!;
  // A kind picked and then hidden falls back to all of them.
  const picked = focus && kinds.includes(focus) ? focus : null;
  const shown = picked ? [picked] : kinds;
  const total = s ? sumOf(s.split, shown) : 0;
  const compared = s ? change(total, s.previousSplit ? sumOf(s.previousSplit, shown) : null, p.last) : null;

  return (
    <View style={{ gap: 14 }}>
      <Chips wrap options={PERIODS} value={period} onPick={setPeriod} />

      <View style={{ padding: 18, borderRadius: 16, backgroundColor: t.surface, gap: 16 }}>
        {s ? (
          <>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Caption>{picked ? `${KIND_LABEL[picked]} ${p.this.toLowerCase()}` : p.this}</Caption>
                <Text style={{ fontFamily: fonts.extrabold, fontSize: 34, lineHeight: 44, letterSpacing: -0.8, color: t.text }}>{duration(total) || "0m"}</Text>
                {compared ? <Text variant="small">{compared}</Text> : null}
              </View>
              {picked ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setFocus(null)}
                  hitSlop={6}
                  style={({ pressed }) => ({ height: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: "center", backgroundColor: t.surface2, opacity: pressed ? 0.85 : 1 })}
                >
                  <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: t.text }}>Show all</Text>
                </Pressable>
              ) : null}
            </View>
            <Bars stats={s} kinds={shown} now={currentKey(period, today)} />
            {kinds.length > 1 ? <Legend split={s.split} kinds={kinds} picked={picked} onPick={(k) => setFocus(picked === k ? null : k)} /> : null}
          </>
        ) : stats.isError ? (
          <Text variant="small">{"Couldn't load your stats."}</Text>
        ) : (
          <Skeleton style={{ gap: 16 }}>
            <Bone width={140} height={34} />
            <Bone height={BARS_HEIGHT + 20} />
            <Bone height={96} />
          </Skeleton>
        )}
      </View>

      {s ? (
        <Grid columns={2} gap={10}>
          {tiles(s, picked, kinds, today).map((x) => (
            <StatTile key={x.key} value={x.value} label={x.label} color={x.kind ? kindColor(t, x.kind) : undefined} />
          ))}
        </Grid>
      ) : null}

      {s ? <TopItems stats={s} picked={picked} kinds={kinds} period={p.this} /> : null}
    </View>
  );
}

/** One bar per day (per month for a year, per year for all time), stacked by kind, books at the bottom. */
function Bars({ stats, kinds, now }: { stats: StatsDto; kinds: StatsKind[]; now: string }) {
  const t = useTheme();
  const max = Math.max(1, ...stats.bars.map((b) => sumOf(b.split, kinds)));
  const dense = stats.bars.length > 12;
  const months = stats.bars.length > 7 && !dense;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Time per ${stats.period === "year" ? "month" : stats.period === "all" ? "year" : "day"}`}
      style={{ flexDirection: "row", alignItems: "flex-end", gap: dense ? 2 : months ? 4 : 8, height: BARS_HEIGHT + 22 }}
    >
      {stats.bars.map((b, i) => {
        const total = sumOf(b.split, kinds);
        return (
          <View key={b.key} style={{ flex: 1, alignItems: "center", gap: 6 }}>
            {/* A lone bar (all time, in the first year) stays bar-shaped rather than filling the card. */}
            <View style={{ width: "100%", maxWidth: 56, flexDirection: "column-reverse", gap: 2, borderRadius: dense ? 2 : 6, overflow: "hidden" }}>
              {total > 0 ? (
                kinds
                  .filter((k) => secOf(b.split, k) > 0)
                  .map((k) => <View key={k} style={{ height: Math.max(3, (secOf(b.split, k) / max) * BARS_HEIGHT), backgroundColor: kindColor(t, k) }} />)
              ) : (
                <View style={{ height: 3, backgroundColor: t.track }} />
              )}
            </View>
            {/* A month's 30 bars only label each week's first day. */}
            <Text
              numberOfLines={1}
              style={{
                fontFamily: b.key === now ? fonts.extrabold : fonts.semibold,
                fontSize: months ? 10 : 11,
                lineHeight: 16,
                color: b.key === now ? t.text : t.muted,
                width: dense ? 24 : undefined,
                textAlign: "center",
              }}
            >
              {!dense || i % 7 === 0 ? b.label : ""}
            </Text>
          </View>
        );
      })}
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
            backgroundColor: picked === k ? t.surface2 : "transparent",
            opacity: picked && picked !== k ? 0.5 : 1,
          }}
        >
          <Dot color={kindColor(t, k)} />
          <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1, fontSize: 14 }}>
            {KIND_LABEL[k]}
          </Text>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: t.text2 }}>{duration(secOf(split, k)) || "0m"}</Text>
        </Pressable>
      ))}
    </Grid>
  );
}

interface Tile {
  key: string;
  value: string;
  label: string;
  kind?: StatsKind;
}

/** All kinds: streak, daily average and a count for each kind. One kind: its counts and its daily average. */
function tiles(s: StatsDto, picked: StatsKind | null, kinds: StatsKind[], today: string): Tile[] {
  const watched = [s.showEpisodesWatched ? plural(s.showEpisodesWatched, "episode") : null, s.moviesWatched ? plural(s.moviesWatched, "movie") : null]
    .filter(Boolean)
    .join(", ");
  const counts: Record<StatsKind, Tile[]> = {
    book: [{ key: "books", value: plural(s.finishedBooks, "book"), label: "Finished" }],
    episode: [{ key: "podcasts", value: plural(s.episodesPlayed, "podcast"), label: "Played" }],
    music:
      picked === "music"
        ? [
            { key: "songs", value: plural(s.songsPlayed, "song"), label: "Songs played" },
            { key: "albums", value: plural(s.albumsPlayed, "album"), label: "Played from" },
          ]
        : [{ key: "songs", value: plural(s.songsPlayed, "song"), label: "Played" }],
    watch:
      picked === "watch"
        ? [
            { key: "episodes", value: plural(s.showEpisodesWatched, "episode"), label: "Watched" },
            { key: "movies", value: plural(s.moviesWatched, "movie"), label: "Watched" },
          ]
        : [{ key: "watched", value: watched || "0 episodes", label: "Watched" }],
  };
  if (picked) {
    return [...counts[picked], { key: "avg", value: duration(dailyAverage(secOf(s.split, picked), s, today)) || "0m", label: "Daily average" }];
  }
  return [
    { key: "streak", value: plural(s.streakDays, "day"), label: "Streak" },
    { key: "avg", value: duration(dailyAverage(sumOf(s.split, kinds), s, today)) || "0m", label: "Daily average" },
    ...(kinds.length > 1 ? kinds.flatMap((k) => counts[k].map((x) => ({ ...x, kind: k }))) : counts[kinds[0]!]),
  ];
}

/** All kinds: the top item of each. One kind: its top items. */
function TopItems({ stats, picked, kinds, period }: { stats: StatsDto; picked: StatsKind | null; kinds: StatsKind[]; period: string }) {
  const t = useTheme();
  const mine = stats.top.filter((x) => kinds.includes(statsTopKind(x)));
  const song = mine.find((x) => x.kind === "song");
  const items = picked
    ? mine.filter((x) => statsTopKind(x) === picked)
    : // One card per kind; the album card names the top song.
      kinds.flatMap((k) => mine.find((x) => statsTopKind(x) === k && x.kind !== "song") ?? []);
  if (!items.length) return null;
  const title = picked === "watch" ? "Most watched" : picked ? "Most played" : "Top";
  const sub = (x: StatsTop) => {
    if (x.kind === "song") return x.plays ? plural(x.plays, "play") : duration(x.sec);
    if (x.kind === "album" && !picked && song) return song.plays ? `${song.title}, ${plural(song.plays, "play")}` : song.title;
    return duration(x.sec);
  };
  return (
    <View>
      <SectionTitle title={`${title} ${period === "All time" ? "of all time" : period.toLowerCase()}`} />
      <Grid columns={2} gap={12} rowGap={16}>
        {items.map((x) => (
          <Pressable key={`${x.kind}:${x.id}`} accessibilityRole="button" accessibilityLabel={x.title} onPress={() => router.push(topHref(x))} style={{ gap: 2 }}>
            <Cover path={topCover(x)} title={x.title} radius={8} style={{ marginBottom: 6 }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Dot color={kindColor(t, statsTopKind(x))} size={8} />
              <Text style={{ fontFamily: fonts.bold, fontSize: 11, lineHeight: 16, letterSpacing: 0.6, textTransform: "uppercase", color: t.muted }}>{TOP_LABEL[x.kind]}</Text>
            </View>
            <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14, lineHeight: 19 }}>
              {x.title}
            </Text>
            <Text variant="small" numberOfLines={1}>
              {sub(x)}
            </Text>
          </Pressable>
        ))}
      </Grid>
    </View>
  );
}

/** A song opens its album. */
function topHref(x: StatsTop): `/book/${string}` | `/show/${string}` | `/album/${string}` | `/movie/${string}` | `/tv/${string}` {
  if (x.kind === "book") return `/book/${x.id}`;
  if (x.kind === "podcast") return `/show/${x.id}`;
  if (x.kind === "movie") return `/movie/${x.id}`;
  if (x.kind === "tvshow") return `/tv/${x.id}`;
  return `/album/${(x.kind === "song" ? x.albumId : x.id) ?? x.id}`;
}

/** A song shows its album's cover; a movie or show its poster. */
function topCover(x: StatsTop): string | null {
  if (!x.coverHash) return null;
  if (x.kind === "book") return apiPaths.coverUrl(x.id, x.coverHash, 600);
  if (x.kind === "podcast") return apiPaths.podcastCoverUrl(x.id, x.coverHash, 600);
  if (x.kind === "movie") return apiPaths.movieArtUrl(x.id, "poster", x.coverHash, "small");
  if (x.kind === "tvshow") return apiPaths.showArtUrl(x.id, "poster", x.coverHash, "small");
  return apiPaths.albumCoverUrl((x.kind === "song" ? x.albumId : x.id) ?? x.id, x.coverHash, 600);
}

function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

/** Equal columns; a short last row keeps its cells the same width rather than stretching them. */
function Grid({ columns, gap, rowGap = gap, children }: { columns: number; gap: number; rowGap?: number; children: React.ReactNode[] }) {
  const cells = children.filter(Boolean);
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < cells.length; i += columns) rows.push(cells.slice(i, i + columns));
  return (
    <View style={{ gap: rowGap }}>
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

/** A big number with a label under it; a kind's tile has its colour's dot. */
export function StatTile({ value, label, color }: { value: string; label: string; color?: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, padding: 14, borderRadius: 14, backgroundColor: t.surface, gap: 4 }}>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: fonts.extrabold, fontSize: 22, lineHeight: 30, color: t.text }}>
        {value}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {color ? <Dot color={color} size={8} /> : null}
        <Text variant="small">{label}</Text>
      </View>
    </View>
  );
}

/** Your library, three to a row: books, then podcasts, albums, movies and shows while their kinds are shown. */
export function LibraryTiles() {
  const kinds = useStatsKinds();
  const watch = kinds.includes("watch");
  const books = useBooks().data;
  const shows = usePodcasts().data;
  const music = useMusicSummary().data;
  const movies = useMovies(watch).data;
  const tvShows = useShows(watch).data;
  if (!books) return null;
  const tile = (n: number, one: string, many: string) => <StatTile key={many} value={String(n)} label={n === 1 ? one : many} />;
  return (
    <View>
      <SectionTitle title="Your library" />
      <Grid columns={3} gap={10}>
        {[
          tile(books.length, "Book", "Books"),
          kinds.includes("episode") && shows ? tile(shows.length, "Podcast", "Podcasts") : null,
          kinds.includes("music") && music ? tile(music.mine.albums, "Album", "Albums") : null,
          watch && movies?.length ? tile(movies.length, "Movie", "Movies") : null,
          watch && tvShows?.length ? tile(tvShows.length, "Show", "Shows") : null,
        ]}
      </Grid>
    </View>
  );
}
