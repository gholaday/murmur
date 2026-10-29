"use client";

import { useEffect, useState } from "react";
import {
  apiPaths,
  duration,
  localDay,
  plural,
  STATS_KIND_LABEL,
  STATS_PERIOD_CHOICES,
  STATS_TOP_LABEL,
  statsChange,
  statsCurrentKey,
  type StatsDto,
  type StatsKind,
  type StatsPeriod,
  type StatsTop,
  statsSum,
  statsTiles,
  statsTopKind,
} from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { Chip, Chips, StatTile } from "../ui";

// The wording and rules are shared with the app; only the colours are the web's.
const PERIODS = STATS_PERIOD_CHOICES;
const KINDS: Record<StatsKind, { label: string; color: string }> = {
  book: { label: STATS_KIND_LABEL.book, color: "var(--accent)" },
  episode: { label: STATS_KIND_LABEL.episode, color: "var(--stat-2)" },
  music: { label: STATS_KIND_LABEL.music, color: "var(--stat-3)" },
  watch: { label: STATS_KIND_LABEL.watch, color: "var(--stat-4)" },
};
const TOP_LABEL = STATS_TOP_LABEL;
const change = statsChange;
const currentKey = statsCurrentKey;
const sumOf = statsSum;
const tiles = statsTiles;

/**
 * Stats on the You page: the time for a period with a chart stacked by kind, a legend that picks
 * one kind, tiles and the top items. `kinds` are the ones shown: a hidden tab, or a server with no
 * music or videos, leaves its kind out everywhere, the total included.
 */
export function ListeningStats({ kinds }: { kinds: StatsKind[] }) {
  const [period, setPeriod] = useState<StatsPeriod>("week");
  const [focus, setFocus] = useState<StatsKind | null>(null);
  const [stats, setStats] = useState<StatsDto | null>(null);
  const [failed, setFailed] = useState(false);
  const today = localDay();

  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ period, today: localDay(), tz: String(-new Date().getTimezoneOffset()) });
    api<StatsDto>(`/api/stats?${q}`).then(
      (s) => {
        if (!live) return;
        setStats(s);
        setFailed(false);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [period]);

  const p = PERIODS.find((x) => x.id === period)!;
  // A kind picked and then hidden falls back to all of them.
  const picked = focus && kinds.includes(focus) ? focus : null;
  const shown = picked ? [picked] : kinds;
  const pickable = kinds.length > 1;

  return (
    <section className="section">
      <Chips kind="radio" label="Period">
        {PERIODS.map((x) => (
          <Chip key={x.id} selected={period === x.id} onClick={() => setPeriod(x.id)}>
            {x.label}
          </Chip>
        ))}
      </Chips>

      {failed && !stats ? <div className="card-box stats-card muted small">Couldn&apos;t load your stats.</div> : null}
      {stats ? (
        <>
          <div className="card-box stats-card">
            <div className="stats-head">
              <div className="stats-head-text">
                <span className="eyebrow">{picked ? `${KINDS[picked].label} ${p.this.toLowerCase()}` : p.this}</span>
                <span className="stats-total">{duration(sumOf(stats.split, shown)) || "0m"}</span>
                {change(sumOf(stats.split, shown), stats.previousSplit ? sumOf(stats.previousSplit, shown) : null, p.last) ? (
                  <span className="muted small">{change(sumOf(stats.split, shown), stats.previousSplit ? sumOf(stats.previousSplit, shown) : null, p.last)}</span>
                ) : null}
              </div>
              {picked ? (
                <button type="button" className="btn btn-small" onClick={() => setFocus(null)}>
                  Show all
                </button>
              ) : null}
            </div>
            <Bars stats={stats} kinds={shown} now={currentKey(period, today)} />
            {pickable ? (
              <div className="stats-legend">
                {kinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`stats-legend-item${picked === k ? " on" : picked ? " dim" : ""}`}
                    style={{ "--kind": KINDS[k].color } as React.CSSProperties}
                    aria-pressed={picked === k}
                    onClick={() => setFocus(picked === k ? null : k)}
                  >
                    <span className="stats-dot" />
                    <span className="stats-legend-label">{KINDS[k].label}</span>
                    <span className="stats-legend-time">{duration(stats.split[k]) || "0m"}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="stats-tiles">
            {tiles(stats, picked, kinds, today).map((t) => (
              <StatTile
                key={t.key}
                value={t.value}
                label={
                  t.kind ? (
                    <span className="stats-tile-label">
                      <span className="stats-dot small" style={{ background: KINDS[t.kind].color }} />
                      {t.label}
                    </span>
                  ) : (
                    t.label
                  )
                }
              />
            ))}
          </div>

          <TopItems stats={stats} picked={picked} kinds={kinds} title={picked === "watch" ? "Most watched" : picked ? "Most played" : "Top"} period={p.this} />
        </>
      ) : null}
    </section>
  );
}

/** One bar per day (per month for a year, per year for all time), stacked by kind. */
function Bars({ stats, kinds, now }: { stats: StatsDto; kinds: StatsKind[]; now: string }) {
  const max = Math.max(1, ...stats.bars.map((b) => sumOf(b.split, kinds)));
  // A month has too many days to label each bar; every seventh keeps it readable.
  const labelEvery = stats.bars.length > 12 ? 7 : 1;
  const per = stats.period === "year" ? "month" : stats.period === "all" ? "year" : "day";
  return (
    <div className="stats-bars" role="img" aria-label={`Time per ${per}`} style={{ gridTemplateColumns: `repeat(${stats.bars.length}, minmax(0, 1fr))` }}>
      {stats.bars.map((b, i) => {
        const total = sumOf(b.split, kinds);
        return (
          <div key={b.key} className="stats-bar" title={`${b.label}: ${duration(total) || "none"}`}>
            <div className="stats-bar-stack">
              {total > 0 ? (
                kinds
                  .filter((k) => b.split[k] > 0)
                  .map((k) => <div key={k} style={{ height: `${Math.max(3, (b.split[k] / max) * 112)}px`, background: KINDS[k].color }} />)
              ) : (
                <div className="stats-bar-empty" />
              )}
            </div>
            <span className={`stats-bar-label${b.key === now ? " now" : ""}`}>{i % labelEvery === 0 ? b.label : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

/** All kinds: the top item of each. One kind: its top items. */
function TopItems({ stats, picked, kinds, title, period }: { stats: StatsDto; picked: StatsKind | null; kinds: StatsKind[]; title: string; period: string }) {
  const mine = stats.top.filter((t) => kinds.includes(statsTopKind(t)));
  const song = mine.find((t) => t.kind === "song");
  const items = picked
    ? mine.filter((t) => statsTopKind(t) === picked)
    : // One card per kind; the album card names the top song.
      kinds.flatMap((k) => mine.find((t) => statsTopKind(t) === k && t.kind !== "song") ?? []);
  if (!items.length) return null;
  const sub = (t: StatsTop) => {
    if (t.kind === "song") return t.plays ? plural(t.plays, "play") : duration(t.sec);
    if (t.kind === "album" && !picked && song) return song.plays ? `${song.title}, ${plural(song.plays, "play")}` : song.title;
    return duration(t.sec);
  };
  return (
    <section className="section">
      <h2 className="section-title">{`${title} ${period === "All time" ? "of all time" : period.toLowerCase()}`}</h2>
      <div className="stats-top-grid">
        {items.map((t) => (
          <a key={`${t.kind}:${t.id}`} className="stats-top-card" href={topHref(t)}>
            <Cover src={topCover(t)} color={null} title={t.title} className="stats-top-cover" />
            <span className="stats-top-kind">
              <span className="stats-dot small" style={{ background: KINDS[statsTopKind(t)].color }} />
              {TOP_LABEL[t.kind]}
            </span>
            <span className="stats-top-title">{t.title}</span>
            <span className="muted small stats-top-sub">{sub(t)}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function topHref(t: StatsTop): string {
  if (t.kind === "book") return `/book/${t.id}`;
  if (t.kind === "podcast") return `/podcasts/${t.id}`;
  if (t.kind === "movie") return `/watch/movie/${t.id}`;
  if (t.kind === "tvshow") return `/watch/show/${t.id}`;
  return `/music/album/${t.kind === "song" ? t.albumId : t.id}`;
}

function topCover(t: StatsTop): string | null {
  if (!t.coverHash) return null;
  if (t.kind === "book") return apiPaths.coverUrl(t.id, t.coverHash, 600);
  if (t.kind === "podcast") return apiPaths.podcastCoverUrl(t.id, t.coverHash, 600);
  if (t.kind === "movie") return apiPaths.movieArtUrl(t.id, "poster", t.coverHash, "small");
  if (t.kind === "tvshow") return apiPaths.showArtUrl(t.id, "poster", t.coverHash, "small");
  return apiPaths.albumCoverUrl(t.kind === "song" ? t.albumId! : t.id, t.coverHash, 600);
}
