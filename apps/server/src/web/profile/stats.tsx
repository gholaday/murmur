"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  duration,
  localDay,
  apiPaths,
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
import { api } from "../api";
import { Cover } from "../cover";
import { ChevronIcon } from "../icons";
import { Chip, Chips, EmptyState, NestedHead } from "../ui";

// The wording and rules are shared with the app; only the colours are the web's (--stat-* in web/base.css).
const color = (kind: StatsKind) => `var(--stat-${kind})`;

/** One period's stats, or null while they load. `year` asks for an earlier year. */
function useStats(period: StatsPeriod, year?: number) {
  const [stats, setStats] = useState<{ key: string; dto: StatsDto } | null>(null);
  const [failed, setFailed] = useState(false);
  const key = `${period}:${year ?? ""}`;
  useEffect(() => {
    let live = true;
    api<StatsDto>(apiPaths.stats({ period, today: localDay(), tz: String(-new Date().getTimezoneOffset()), year })).then(
      (dto) => {
        if (!live) return;
        setStats({ key, dto });
        setFailed(false);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [key, period, year]);
  return { stats: stats?.key === key ? stats.dto : null, failed };
}

/** The card on You: this week and a line of its days, opening Stats. */
export function StatsCard({ kinds }: { kinds: StatsKind[] }) {
  const { stats, failed } = useStats("week");
  const today = localDay();
  if (failed && !stats) return <div className="card-box stats-card muted small">Couldn&apos;t load your stats.</div>;
  const compared = stats ? statsCompared(stats, kinds) : null;
  return (
    <Link href="/you/stats" className="card-box stats-card stats-entry">
      <div className="stats-head">
        <div className="stats-head-text">
          <span className="eyebrow">{statsTotalLabel(null, "week")}</span>
          <span className="stats-total">{stats ? duration(statsSum(stats.split, kinds)) || "0m" : " "}</span>
          <span className="muted small">{compared ?? " "}</span>
        </div>
        <ChevronIcon />
      </div>
      {stats ? (
        <Spark stats={stats} kinds={kinds} today={today} />
      ) : (
        <div>
          <div className="stats-spark" />
          <div className="stats-axis" />
        </div>
      )}
    </Link>
  );
}

const SPARK = { width: 358, height: 64 };

/** The days of the period so far as one line, with a faint track for those to come. */
function Spark({ stats, kinds, today }: { stats: StatsDto; kinds: StatsKind[]; today: string }) {
  const { values, slots } = statsSpark(stats, kinds, today);
  const { line, area, x, y } = sparkPaths(values, slots, SPARK.width, SPARK.height);
  return (
    <div>
      <svg className="stats-spark" viewBox={`0 0 ${SPARK.width} ${SPARK.height}`} role="img" aria-label={`Time per day ${statsTotalLabel(null, stats.period).toLowerCase()}`}>
        {x < SPARK.width - 8 ? <line className="stats-spark-track" x1={x} y1={SPARK.height - 2} x2={SPARK.width - 4} y2={SPARK.height - 2} /> : null}
        <path className="stats-spark-area" d={area} />
        <path className="stats-spark-line" d={line} />
        <circle className="stats-spark-dot" cx={x} cy={y} r={4.5} />
      </svg>
      <div className="stats-axis" aria-hidden="true">
        {statsSparkAxis(stats, today).map((l) => (
          <span key={l.text} className={l.today ? "today" : undefined} style={{ left: `${l.at * 100}%`, transform: `translateX(${-l.at * 100}%)` }}>
            {l.text}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Stats: sentences for a week or month, the ring for a year, and each year's ring for all time. */
export function StatsPage({ kinds }: { kinds: StatsKind[] }) {
  const [period, setPeriod] = useState<StatsPeriod>("week");
  const { stats, failed } = useStats(period);
  const today = localDay();
  const nothing = stats?.firstDay === null;
  return (
    <>
      <NestedHead title="Stats" fallback="/you" />
      {nothing ? (
        <EmptyState title="No plays yet">Play something and your stats start here.</EmptyState>
      ) : (
        <>
          <Chips kind="tabs" label="Period">
            {STATS_PERIOD_CHOICES.map((x) => (
              <Chip key={x.id} selected={period === x.id} onClick={() => setPeriod(x.id)}>
                {x.label}
              </Chip>
            ))}
          </Chips>
          {failed && !stats ? <div className="muted small stats-view">Couldn&apos;t load your stats.</div> : null}
          {stats ? (
            <div className="stats-view" key={period}>
              {period === "year" ? (
                <YearView stats={stats} kinds={kinds} today={today} />
              ) : period === "all" ? (
                <AllTimeView stats={stats} kinds={kinds} today={today} />
              ) : (
                <SentencesView stats={stats} kinds={kinds} today={today} />
              )}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

function Headline({ stats, kinds, sub }: { stats: StatsDto; kinds: StatsKind[]; sub: string | null }) {
  const { text, mostly, kind } = statsHeadline(stats, kinds);
  return (
    <div className="stats-headline">
      <p className="stats-sentence">
        {text}
        {mostly ? (
          <>
            , mostly <span style={{ color: kind ? color(kind) : undefined }}>{mostly}</span>
          </>
        ) : null}
        .
      </p>
      {sub ? <p className="stats-sentence-sub">{sub}</p> : null}
    </div>
  );
}

/** A week or month, or all time in your first year. */
function SentencesView({ stats, kinds, today }: { stats: StatsDto; kinds: StatsKind[]; today: string }) {
  const lines = statsLines(stats, kinds);
  const days = stats.period === "week" ? statsDayRows(stats, kinds, today) : [];
  return (
    <>
      <Headline stats={stats} kinds={kinds} sub={stats.period === "all" ? statsSinceLine(stats, today) : statsCompared(stats, kinds)} />
      {stats.period === "all" || !statsSum(stats.split, kinds) ? null : <Spark stats={stats} kinds={kinds} today={today} />}
      {stats.period === "week" ? (
        days.length ? (
          <div className="stats-lines">
            {days.map((d) => (
              <Link key={d.day} className="stats-day" href={topHref(d.top)}>
                <span className={`stats-day-label${d.day === today ? " now" : ""}`}>{d.label}</span>
                <Cover src={statsTopCover(d.top)} color={null} title={d.top.title} className="stats-day-cover" />
                <span className="stats-day-title">{d.top.title}</span>
                <span className="muted small">{d.time}</span>
              </Link>
            ))}
          </div>
        ) : null
      ) : lines.length ? (
        <div className="stats-lines">
          {lines.map((l) =>
            l.top ? (
              <Link key={l.text} className="stats-line" href={topHref(l.top)}>
                <Cover src={statsTopCover(l.top)} color={null} title={l.top.title} className="stats-line-cover" />
                <span className="stats-line-text">{l.text}</span>
                <ChevronIcon />
              </Link>
            ) : (
              <div key={l.text} className="stats-line">
                <span className="stats-line-text">{l.text}</span>
              </div>
            ),
          )}
        </div>
      ) : null}
      <TopItems stats={stats} picked={null} kinds={kinds} />
    </>
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
      {kinds.length > 1 ? (
        <div className="stats-legend">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              className={`stats-legend-item${picked === k ? " on" : picked ? " dim" : ""}`}
              style={{ "--kind": color(k) } as React.CSSProperties}
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

function YearPicker({ stats, kinds, today, years }: { stats: StatsDto; kinds: StatsKind[]; today: string; years: Array<{ year: number; sec: number }> }) {
  const thisYear = Number(today.slice(0, 4));
  const [picked, setPicked] = useState(years[years.length - 1]!.year);
  const past = picked < thisYear ? picked : undefined;
  const { stats: year, failed } = useStats("year", picked);
  const strip = useRef<HTMLDivElement>(null);
  // It starts on the latest year, the last tile.
  useEffect(() => {
    strip.current?.scrollTo({ left: strip.current.scrollWidth });
  }, []);
  return (
    <>
      <div className="stats-alltime">
        <span className="stats-alltime-total">{duration(statsSum(stats.split, kinds)) || "0m"}</span>
        <span className="muted small">{statsSinceLabel(stats.from)}</span>
      </div>
      {year ? (
        <Ring stats={year} kinds={kinds} today={today} year={picked} eyebrow={String(picked)} note={statsRingNote(year, kinds, today, past)} />
      ) : (
        <div className="stats-ring">{failed ? <span className="muted small">Couldn&apos;t load this year.</span> : null}</div>
      )}
      <div ref={strip} className="stats-years" role="radiogroup" aria-label="Year">
        {years.map((y) => (
          <button key={y.year} type="button" className="stats-year" role="radio" aria-checked={picked === y.year} onClick={() => setPicked(y.year)}>
            {y.year}
          </button>
        ))}
      </div>
      {year ? <TopItems stats={year} picked={null} kinds={kinds} year={picked} /> : null}
    </>
  );
}

const RING = 358;

/** Every day of a year around a ring: longer for more time, coloured by that week's main kind. */
function Ring({ stats, kinds, today, year, eyebrow, note }: { stats: StatsDto; kinds: StatsKind[]; today: string; year: number; eyebrow: string; note: string | null }) {
  const ring = statsRing(year, stats.days, kinds);
  const { stubs, spokes } = ringPaths(ring, RING);
  const now = ringToday(ring, today, RING);
  return (
    <div className="stats-ring">
      <svg viewBox={`0 0 ${RING} ${RING}`} role="img" aria-label={`Every day of ${year} around a ring, longer for more time`}>
        <path className="stats-ring-stub" d={stubs} />
        {kinds.map((k) => (spokes[k] ? <path key={k} className="stats-ring-spoke" d={spokes[k]} style={{ stroke: color(k) }} /> : null))}
        {now ? <line className="stats-ring-now" {...now} /> : null}
      </svg>
      <div className="stats-ring-middle">
        <span className="eyebrow">{eyebrow}</span>
        <span className="stats-total">{duration(statsSum(stats.split, kinds)) || "0m"}</span>
        {note ? <span className="muted small">{note}</span> : null}
      </div>
      <span className="stats-ring-month jan">Jan</span>
      <span className="stats-ring-month apr">Apr</span>
      <span className="stats-ring-month jul">Jul</span>
      <span className="stats-ring-month oct">Oct</span>
    </div>
  );
}

/** The period's top things, longest first. */
function TopItems({ stats, picked, kinds, year }: { stats: StatsDto; picked: StatsKind | null; kinds: StatsKind[]; year?: number }) {
  const { title, items } = statsTopItems(stats, picked, kinds, year);
  if (!items.length) return null;
  return (
    <section className="section stats-top">
      <h2 className="section-title">{title}</h2>
      <div className="stats-top-strip">
        {items.map(({ top: t, label, sub }) => (
          <Link key={`${t.kind}:${t.id}`} className="stats-top-card" href={topHref(t)}>
            <Cover src={statsTopCover(t)} color={null} title={t.title} className="stats-top-cover" />
            <span className="stats-top-kind">
              <span className="stats-dot small" style={{ background: color(statsTopKind(t)) }} />
              {label}
            </span>
            <span className="stats-top-title">{t.title}</span>
            <span className="muted small stats-top-sub">{sub}</span>
          </Link>
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
