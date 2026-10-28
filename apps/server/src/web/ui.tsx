"use client";

/**
 * The small building blocks every screen shares (docs/DESIGN.md, Components). Screens use
 * these instead of writing the class names out, so a change to one shows up everywhere.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { plural } from "@murmur/shared/client";
import { BackIcon, ChevronIcon, SearchIcon } from "./icons";

/**
 * A sideways row (`shelf` or `row-scroll`) with arrows that page it left and right. They only
 * show for a mouse, while it's over the row, and each hides once its end is reached.
 */
export function ScrollRow({ className = "shelf", children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ start: true, end: true });
  const update = () => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft <= 1;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setEnds((e) => (e.start === start && e.end === end ? e : { start, end }));
  };
  // Cards can arrive or change after the first paint, and the window can be resized.
  useEffect(update);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const page = (dir: 1 | -1) => {
    const el = ref.current;
    el?.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };
  return (
    <div className="scroll-row">
      <div ref={ref} className={className} onScroll={update}>
        {children}
      </div>
      <button type="button" className="scroll-arrow prev" aria-label="Scroll left" tabIndex={-1} hidden={ends.start} onClick={() => page(-1)}>
        <ChevronIcon size={20} style={{ transform: "rotate(180deg)" }} />
      </button>
      <button type="button" className="scroll-arrow next" aria-label="Scroll right" tabIndex={-1} hidden={ends.end} onClick={() => page(1)}>
        <ChevronIcon size={20} />
      </button>
    </div>
  );
}

/** Goes back, or to `fallback` when the page was opened directly. */
export function BackButton({ fallback = "/", onClick }: { fallback?: string; onClick?: () => void }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label="Back"
      onClick={onClick ?? (() => (window.history.length > 1 ? router.back() : router.push(fallback)))}
    >
      <BackIcon />
    </button>
  );
}

/** The back arrow on its own row, above a nested screen's title; `children` go on the right. */
export function BackRow({ fallback, onClick, children }: { fallback?: string; onClick?: () => void; children?: React.ReactNode }) {
  return (
    <div className="hero-bar back-row">
      <BackButton fallback={fallback} onClick={onClick} />
      {children}
    </div>
  );
}

/**
 * A nested screen's head: the back arrow on its own row, then the title with its count,
 * an optional sub line, and actions on the right.
 */
export function NestedHead({
  title,
  count,
  noun,
  sub,
  actions,
  fallback,
  onBack,
}: {
  title: string;
  count?: number;
  noun?: string;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  fallback?: string;
  onBack?: () => void;
}) {
  return (
    <>
      <BackRow fallback={fallback} onClick={onBack} />
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title" style={{ fontSize: 26 }}>
            {count !== undefined ? <TitleWithCount title={title} count={count} noun={noun} /> : title}
          </h1>
          {sub ? <div className="page-sub">{sub}</div> : null}
        </div>
        {actions ? <div className="head-actions">{actions}</div> : null}
      </div>
    </>
  );
}

/** Keeps the count pill on the same line as the title's last word when it wraps. */
export function TitleWithCount({ title, count, noun = "book" }: { title: string; count: number; noun?: string }) {
  const cut = title.lastIndexOf(" ") + 1;
  return (
    <>
      {title.slice(0, cut)}
      <span style={{ whiteSpace: "nowrap" }}>
        {title.slice(cut)}
        <CountPill count={count} noun={noun} />
      </span>
    </>
  );
}

/** The search box that opens under a page head, focused as it opens. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="search">
      <SearchIcon />
      <input className="input" type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} autoFocus />
    </div>
  );
}

/** One bold line and one muted sentence, or just the sentence. */
export function EmptyState({ title, children, style }: { title?: React.ReactNode; children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="empty" style={style}>
      {title ? <strong>{title}</strong> : null}
      {children}
    </div>
  );
}

/** The grey badge counting what's in a list, read out as "12 books". */
export function CountPill({ count, noun }: { count: number; noun?: string }) {
  return (
    <span className="count-pill" aria-label={noun ? plural(count, noun) : undefined}>
      {count}
    </span>
  );
}

/** A section heading with its count, as a button when it opens the whole list. */
export function SectionTitle({ title, count, noun, onOpen }: { title: React.ReactNode; count?: number; noun?: string; onOpen?: () => void }) {
  const inner = (
    <>
      {title}
      {count !== undefined ? <CountPill count={count} noun={noun} /> : null}
    </>
  );
  return onOpen ? (
    <button type="button" className="section-title group-title" onClick={onOpen}>
      {inner}
    </button>
  ) : (
    <h2 className="section-title">{inner}</h2>
  );
}

/**
 * How a row of chips behaves: `tabs` switches views, `radio` picks one setting, and `toggle`
 * turns each chip on or off by itself.
 */
type ChipsKind = "tabs" | "radio" | "toggle";
const ChipsKindContext = createContext<ChipsKind>("toggle");

export function Chips({
  kind = "toggle",
  label,
  wrap,
  children,
}: {
  kind?: ChipsKind;
  label?: string;
  wrap?: boolean;
  children: React.ReactNode;
}) {
  const role = kind === "tabs" ? "tablist" : kind === "radio" ? "radiogroup" : undefined;
  return (
    <ChipsKindContext.Provider value={kind}>
      <div className="chips" role={role} aria-label={label} style={wrap ? { flexWrap: "wrap" } : undefined}>
        {children}
      </div>
    </ChipsKindContext.Provider>
  );
}

export function Chip({
  selected,
  onClick,
  disabled,
  warn,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  /** Amber, for a view of things that need fixing. */
  warn?: boolean;
  children: React.ReactNode;
}) {
  const kind = useContext(ChipsKindContext);
  return (
    <button
      type="button"
      className={warn ? "chip chip-warn" : "chip"}
      role={kind === "tabs" ? "tab" : kind === "radio" ? "radio" : undefined}
      aria-selected={kind === "tabs" ? selected : undefined}
      aria-checked={kind === "radio" ? selected : undefined}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** A group of settings rows on a surface card. */
export function SettingsCard({ children }: { children: React.ReactNode }) {
  return <div className="card-box">{children}</div>;
}

/**
 * One settings row: a title with optional sub lines on the left, its control on the right.
 * `wrap` lets a row of chips drop below the title on narrow screens.
 */
export function Setting({
  title,
  sub,
  dot,
  wrap,
  children,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  /** A status dot before the title: fine, or needs a look. */
  dot?: "ok" | "warn";
  wrap?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="setting" style={wrap ? { flexWrap: "wrap", paddingBlock: 10 } : undefined}>
      <span className="setting-text">
        <span className="setting-title">
          {dot ? <StatusDot warn={dot === "warn"} /> : null}
          {title}
        </span>
        {sub}
      </span>
      {children}
    </div>
  );
}

/** A setting's sub line, red when it's an error. */
export function SettingSub({ error, children }: { error?: boolean; children: React.ReactNode }) {
  return <span className={`setting-sub ${error ? "error" : ""}`}>{children}</span>;
}

export function StatusDot({ warn }: { warn?: boolean }) {
  return <span className={`status-dot ${warn ? "warn" : ""}`} />;
}

/** A settings row that opens its own screen, with its current value and a chevron. */
export function SettingLink({ title, value, href }: { title: string; value?: string | null; href: string }) {
  return (
    <Link href={href} className="setting setting-link">
      <span className="setting-title">{title}</span>
      <span className="setting-value">
        {value ? <span>{value}</span> : null}
        <ChevronIcon />
      </span>
    </Link>
  );
}

/** A settings row with an on/off switch. Leave out `checked` inside a form to read it from FormData. */
export function SwitchRow({
  title,
  sub,
  label,
  name,
  checked,
  onChange,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  label?: string;
  name?: string;
  checked?: boolean;
  onChange?: (on: boolean) => void;
}) {
  return (
    <label className="switch">
      <span className="setting-text">
        <span className="setting-title">{title}</span>
        {sub ? <span className="setting-sub">{sub}</span> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        name={name}
        aria-label={label}
        checked={checked}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
      />
    </label>
  );
}

/**
 * A danger button that asks once in place: the first click turns it into Keep and the
 * confirm button, so nothing saved is deleted by a stray click.
 */
export function ConfirmRemove({
  label = "Remove",
  confirmLabel = label,
  busy,
  onConfirm,
}: {
  label?: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => Promise<unknown> | void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="btn btn-danger" style={{ flexShrink: 0 }} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
      <button type="button" className="btn" onClick={() => setAsking(false)}>
        Keep
      </button>
      <button
        type="button"
        className="btn btn-danger"
        disabled={busy}
        onClick={async () => {
          await onConfirm();
          setAsking(false);
        }}
      >
        {confirmLabel}
      </button>
    </span>
  );
}

/** Full-width tabs for switching a whole screen between two or three views, like Stats and Settings on You. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={o.id === value} onClick={() => o.id !== value && onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A big number with its label under it. */
export function StatTile({ value, label }: { value: React.ReactNode; label: React.ReactNode }) {
  return (
    <div className="stats-tile">
      <div className="stats-tile-value">{value}</div>
      <div className="muted small">{label}</div>
    </div>
  );
}
