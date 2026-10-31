"use client";

import { useEffect, useState } from "react";
import {
  duration,
  localDay,
  STATS_KIND_LABEL,
  STATS_PERIOD_CHOICES,
  STATS_TOP_LABEL,
  statsBarsLabel,
  statsChange,
  statsCurrentKey,
  type StatsDto,
  type StatsKind,
  type StatsPeriod,
  type StatsTop,
  statsSum,
  statsTiles,
  statsTopCover,
  statsTopItems,
  statsTopKind,
  statsTopTarget,
  statsTotalLabel,
} from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { Chip, Chips, StatTile } from "../ui";

// The wording and rules are shared with the app; only the colours are the web's.
const COLOR: Record<StatsKind, string> = { book: "var(--accent)", episode: "var(--stat-2)", music: "var(--stat-3)", watch: "var(--stat-4)" };

/**
 * Stats on the You page: the time for a period with a chart stacked by kind, a legend that picks
 * one kind, tiles and the top items. `kinds` are the ones shown: a hidden tab leaves its kind out
 * everywhere, the total included.
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

  const p = STATS_PERIOD_CHOICES.find((x) => x.id === period)!;
  // A kind picked and then hidden falls back to all of them.
  const picked = focus && kinds.includes(focus) ? focus : null;
  const shown = picked ? [picked] : kinds;
  const total = stats ? statsSum(stats.split, shown) : 0;
  const compared = stats ? statsChange(total, stats.previousSplit ? statsSum(stats.previousSplit, shown) : null, p.last) : null;

  return (
    <section className="section">
      <Chips kind="radio" label="Period">
        {STATS_PERIOD_CHOICES.map((x) => (
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
                <span className="eyebrow">{statsTotalLabel(picked, period)}</span>
                <span className="stats-total">{duration(total) || "0m"}</span>
                {compared ? <span className="muted small">{compared}</span> : null}
              </div>
              {picked ? (
                <button type="button" className="btn btn-small" onClick={() => setFocus(null)}>
                  Show all
                </button>
              ) : null}
            </div>
            <Bars stats={stats} kinds={shown} now={statsCurrentKey(period, today)} />
            {kinds.length > 1 ? (
              <div className="stats-legend">
                {kinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`stats-legend-item${picked === k ? " on" : picked ? " dim" : ""}`}
                    style={{ "--kind": COLOR[k] } as React.CSSProperties}
                    aria-pressed={picked === k}
                    onClick={() => setFocus(picked === k ? null : k)}
                  >
                    <span className="stats-dot" />
                    <span className="stats-legend-label">{STATS_KIND_LABEL[k]}</span>
                    <span className="stats-legend-time">{duration(stats.split[k]) || "0m"}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="stats-tiles">
            {statsTiles(stats, picked, kinds, today).map((t) => (
              <StatTile
                key={t.key}
                value={t.value}
                label={
                  t.kind ? (
                    <span className="stats-tile-label">
                      <span className="stats-dot small" style={{ background: COLOR[t.kind] }} />
                      {t.label}
                    </span>
                  ) : (
                    t.label
                  )
                }
              />
            ))}
          </div>

          <TopItems stats={stats} picked={picked} kinds={kinds} />
        </>
      ) : null}
    </section>
  );
}

/** One bar per day (per month for a year, per year for all time), stacked by kind. */
function Bars({ stats, kinds, now }: { stats: StatsDto; kinds: StatsKind[]; now: string }) {
  const max = Math.max(1, ...stats.bars.map((b) => statsSum(b.split, kinds)));
  // A month has too many days to label each bar; every seventh keeps it readable.
  const labelEvery = stats.bars.length > 12 ? 7 : 1;
  return (
    <div className="stats-bars" role="img" aria-label={statsBarsLabel(stats.period)} style={{ gridTemplateColumns: `repeat(${stats.bars.length}, minmax(0, 1fr))` }}>
      {stats.bars.map((b, i) => {
        const total = statsSum(b.split, kinds);
        return (
          <div key={b.key} className="stats-bar" title={`${b.label}: ${duration(total) || "none"}`}>
            <div className="stats-bar-stack">
              {total > 0 ? (
                kinds
                  .filter((k) => b.split[k] > 0)
                  .map((k) => <div key={k} style={{ height: `${Math.max(3, (b.split[k] / max) * 112)}px`, background: COLOR[k] }} />)
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
function TopItems({ stats, picked, kinds }: { stats: StatsDto; picked: StatsKind | null; kinds: StatsKind[] }) {
  const { title, items } = statsTopItems(stats, picked, kinds);
  if (!items.length) return null;
  return (
    <section className="section">
      <h2 className="section-title">{title}</h2>
      <div className="stats-top-grid">
        {items.map(({ top: t, sub }) => (
          <a key={`${t.kind}:${t.id}`} className="stats-top-card" href={topHref(t)}>
            <Cover src={statsTopCover(t)} color={null} title={t.title} className="stats-top-cover" />
            <span className="stats-top-kind">
              <span className="stats-dot small" style={{ background: COLOR[statsTopKind(t)] }} />
              {STATS_TOP_LABEL[t.kind]}
            </span>
            <span className="stats-top-title">{t.title}</span>
            <span className="muted small stats-top-sub">{sub}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function topHref(t: StatsTop): string {
  const { kind, id } = statsTopTarget(t);
  if (kind === "book") return `/book/${id}`;
  if (kind === "podcast") return `/podcasts/${id}`;
  if (kind === "movie") return `/watch/movie/${id}`;
  if (kind === "tvshow") return `/watch/show/${id}`;
  return `/music/album/${id}`;
}
