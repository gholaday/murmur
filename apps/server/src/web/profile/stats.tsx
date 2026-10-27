"use client";

import { useEffect, useState } from "react";
import { apiPaths, duration, localDay, plural, type StatsDto, type StatsPeriod, type StatsTop, statsTopLabel, type UserPrefs } from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";

const PERIODS: Array<{ id: StatsPeriod; label: string; last: string }> = [
  { id: "week", label: "Week", last: "this time last week" },
  { id: "month", label: "Month", last: "this time last month" },
  { id: "year", label: "Year", last: "this time last year" },
  { id: "all", label: "All time", last: "" },
];

/** The listening total compared with the same stretch of the period before. */
function change(stats: StatsDto): string | null {
  if (stats.previousSec === null) return null;
  const diff = stats.totalSec - stats.previousSec;
  const last = PERIODS.find((p) => p.id === stats.period)!.last;
  if (Math.abs(diff) < 60) return `About the same as ${last}`;
  return `${duration(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${last}`;
}

/** The bar for today, or the month or year it's in. */
function currentKey(period: StatsPeriod, today: string): string {
  if (period === "year") return today.slice(0, 7);
  if (period === "all") return today.slice(0, 4);
  return today;
}

/** Listening stats on the You page: a total, bars, the split by kind, and what you played most. */
export function ListeningStats({ tabs }: { tabs: UserPrefs["tabs"] }) {
  const [period, setPeriod] = useState<StatsPeriod>("week");
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

  const max = Math.max(1, ...(stats?.bars.map((b) => b.sec) ?? []));
  const now = currentKey(period, today);
  // A hidden tab hides its part of the split and its Most played rows; the total still counts it.
  const episodeSec = tabs.podcasts ? (stats?.split.episode ?? 0) : 0;
  const musicSec = tabs.music ? (stats?.split.music ?? 0) : 0;
  const kinds = stats ? stats.split.book + episodeSec + musicSec : 0;
  const top = (stats?.top ?? []).filter((t) => (t.kind !== "podcast" || tabs.podcasts) && ((t.kind !== "album" && t.kind !== "song") || tabs.music));
  // A month has too many days to label each bar; every seventh keeps it readable.
  const labelEvery = (stats?.bars.length ?? 0) > 12 ? 7 : 1;

  return (
    <section className="section">
      <h2 className="section-title">Listening</h2>
      <div className="chips" role="radiogroup" aria-label="Period">
        {PERIODS.map((p) => (
          <button key={p.id} type="button" role="radio" className="chip" aria-checked={period === p.id} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      {failed && !stats ? <div className="card-box stats-card muted small">Couldn't load your stats.</div> : null}
      {stats ? (
        <>
          <div className="card-box stats-card">
            <div>
              <div className="stats-total">{duration(stats.totalSec) || "0m"}</div>
              {change(stats) ? <div className="muted small">{change(stats)}</div> : null}
            </div>
            <div
              className="stats-bars"
              role="img"
              aria-label={`Listening per ${period === "year" ? "month" : period === "all" ? "year" : "day"}`}
              style={{ gridTemplateColumns: `repeat(${stats.bars.length}, minmax(0, 1fr))` }}
            >
              {stats.bars.map((b, i) => (
                <div key={b.key} className="stats-bar" title={`${b.label}: ${duration(b.sec) || "none"}`}>
                  <div className={`stats-bar-fill${b.key === now ? " now" : ""}`} style={{ height: `${(b.sec / max) * 100}%` }} />
                  <span className="stats-bar-label">{i % labelEvery === 0 ? b.label : ""}</span>
                </div>
              ))}
            </div>
            {kinds > 0 ? (
              <>
                <div className="stats-split" aria-hidden="true">
                  <div style={{ flex: stats.split.book, background: "var(--accent)" }} />
                  <div style={{ flex: episodeSec, background: "var(--stat-2)" }} />
                  <div style={{ flex: musicSec, background: "var(--stat-3)" }} />
                </div>
                <div className="stats-legend">
                  <div>
                    <span className="stats-dot" style={{ background: "var(--accent)" }} />
                    <span>Books</span>
                    <span className="muted">{duration(stats.split.book) || "0m"}</span>
                  </div>
                  {tabs.podcasts ? (
                    <div>
                      <span className="stats-dot" style={{ background: "var(--stat-2)" }} />
                      <span>Podcasts</span>
                      <span className="muted">{duration(episodeSec) || "0m"}</span>
                    </div>
                  ) : null}
                  {musicSec ? (
                    <div>
                      <span className="stats-dot" style={{ background: "var(--stat-3)" }} />
                      <span>Music</span>
                      <span className="muted">{duration(musicSec)}</span>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>

          <div className="stats-tiles">
            <StatTile value={plural(stats.streakDays, "day")} label="Listening streak" />
            <StatTile value={plural(stats.finishedBooks, "book")} label="Finished" />
            {tabs.podcasts ? <StatTile value={String(stats.episodesPlayed)} label="Episodes played" /> : null}
            {stats.savedSec >= 60 ? <StatTile value={duration(stats.savedSec)} label="Saved by playing faster" /> : null}
          </div>

          {top.length ? (
            <div className="card-box">
              {top.map((t) => (
                <a key={`${t.kind}:${t.id}`} className="setting stats-top" href={topHref(t)}>
                  <Cover src={topCover(t)} color={null} title={t.title} className="stats-top-cover" />
                  <span className="setting-text">
                    <span className="setting-title">{t.title}</span>
                    <span className="setting-sub">{statsTopLabel(t)}</span>
                  </span>
                  <span className="muted small">{duration(t.sec)}</span>
                </a>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function topHref(t: StatsTop): string {
  if (t.kind === "book") return `/book/${t.id}`;
  if (t.kind === "podcast") return `/podcasts/${t.id}`;
  return `/music/album/${t.kind === "song" ? t.albumId : t.id}`;
}

function topCover(t: StatsTop): string | null {
  if (!t.coverHash) return null;
  if (t.kind === "book") return apiPaths.coverUrl(t.id, t.coverHash, 200);
  if (t.kind === "podcast") return apiPaths.podcastCoverUrl(t.id, t.coverHash, 200);
  return apiPaths.albumCoverUrl(t.kind === "song" ? t.albumId! : t.id, t.coverHash, 200);
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="stats-tile">
      <div className="stats-tile-value">{value}</div>
      <div className="muted small">{label}</div>
    </div>
  );
}
