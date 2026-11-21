"use client";

/**
 * The small building blocks every screen shares (docs/DESIGN.md, Components). Screens use
 * these instead of writing the class names out, so a change to one shows up everywhere.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Children, createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { plural } from "@murmur/shared/client";
import { BackIcon, ChevronIcon, MoreIcon, SearchIcon } from "./icons";
import { ChoiceSheet } from "./sheet";

/**
 * Whether a sideways row is at its start and its end, for arrows that page it. `items` is how
 * many things it holds. With `on` false it measures nothing, for rows that never show their ends.
 */
function useScrollEnds(ref: React.RefObject<HTMLDivElement | null>, items: number, on = true) {
  const [ends, setEnds] = useState({ start: true, end: true });
  const update = () => {
    const el = ref.current;
    if (!el || !on) return;
    const start = el.scrollLeft <= 1;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setEnds((e) => (e.start === start && e.end === end ? e : { start, end }));
  };
  // Items can arrive after the first paint, and the window can be resized. Not on every render: a
  // page of rows would measure them all on each keystroke, and an arrow showing can shift the
  // measure and flip the ends back and forth.
  useEffect(update, [items]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [on]);
  const page = (dir: 1 | -1) => {
    const el = ref.current;
    el?.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };
  return { ends, update, page };
}

/**
 * A sideways row (`shelf` or `row-scroll`) with arrows that page it left and right. They only
 * show for a mouse, while it's over the row, and each hides once its end is reached.
 */
export function ScrollRow({ className = "shelf", children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { ends, update, page } = useScrollEnds(ref, Children.count(children));
  return (
    <div className="scroll-row">
      {/* .scroll-track: every sideways row, for its scrollbar and for dragging with the mouse (drag-scroll.ts). */}
      <div ref={ref} className={`${className} scroll-track`} onScroll={update}>
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

/** A choice kept in this browser, like a list's sort. Storage only exists in the browser, so it follows the first render. */
export function useSavedChoice<T extends string>(key: string, fallback: T, choices: ReadonlyArray<{ id: T }>): [T, (next: T) => void] {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key) as T | null;
      if (saved && choices.some((c) => c.id === saved)) setValue(saved);
    } catch {
      // private mode
    }
  }, [key, choices]);
  const save = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // private mode
    }
  };
  return [value, save];
}

/** A description cut short, with More and Less when it's longer than `longerThan` characters. */
export function Description({ text, longerThan = 220, lines }: { text: string; longerThan?: number; lines?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className={`description ${open ? "" : "clamped"}`} style={lines && !open ? { WebkitLineClamp: lines } : undefined}>
        {text}
      </p>
      {text.length > longerThan ? (
        <button type="button" className="more-link" onClick={() => setOpen((o) => !o)}>
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </>
  );
}

/** Goes back, or to `fallback` when the page was opened directly. */
function BackButton({ fallback = "/", onClick }: { fallback?: string; onClick?: () => void }) {
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

/** The top row of a page with a hero (a book, show, movie): the back arrow, and More on the right. */
export function HeroBar({ fallback, onMore }: { fallback?: string; onMore?: () => void }) {
  return (
    <div className="hero-bar">
      <BackButton fallback={fallback} />
      {onMore ? (
        <button type="button" className="icon-btn" aria-label="More options" onClick={onMore}>
          <MoreIcon />
        </button>
      ) : null}
    </div>
  );
}

/**
 * A nested screen's head, on one row like the pages with a hero: the back arrow, the title (with
 * an optional sub line under it) and the actions on the right. A long title stays on one line and
 * ends in "…"; hovering shows all of it.
 */
export function NestedHead({
  title,
  sub,
  actions,
  fallback,
  onBack,
}: {
  title: string;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  fallback?: string;
  onBack?: () => void;
}) {
  return (
    <div className="nested-head">
      <BackButton fallback={fallback} onClick={onBack} />
      <div className="nested-text">
        <h1 className="page-title nested-title" title={title}>
          {title}
        </h1>
        {sub ? <div className="page-sub nested-sub">{sub}</div> : null}
      </div>
      {actions ? <div className="head-actions">{actions}</div> : null}
    </div>
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
export function SectionTitle({
  title,
  count,
  noun,
  onOpen,
}: {
  title: React.ReactNode;
  count?: number;
  noun?: string;
  onOpen?: () => void;
}) {
  const inner = (
    <>
      <span className="section-title-text">{title}</span>
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
 * A page's title row and tabs, kept at the top while the page scrolls, as Library's are. It tells
 * the page where it ends (`--sticky-head`), so a sticky search box further down sits under it.
 */
export function StickyHead({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Before paint, so a sticky box below never shows at the top for a frame.
  useLayoutEffect(() => {
    const head = ref.current;
    const page = head?.parentElement;
    if (!head || !page) return;
    // It sticks at the very top (`.sticky-head`), so nothing shifts as the page scrolls under it.
    const set = () => page.style.setProperty("--sticky-head", `${head.getBoundingClientRect().height}px`);
    set();
    const watch = new ResizeObserver(set);
    watch.observe(head);
    return () => {
      watch.disconnect();
      page.style.removeProperty("--sticky-head");
    };
  }, []);
  return (
    <div ref={ref} className="sticky-head">
      {children}
    </div>
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
  const ref = useRef<HTMLDivElement>(null);
  const tabs = kind === "tabs";
  const { ends, update } = useScrollEnds(ref, Children.count(children), tabs);
  // A plain wheel only scrolls up and down; over tabs that don't fit, it moves them sideways.
  // Listened for on the tabs alone: a wheel listener that can cancel slows scrolling wherever it covers.
  useEffect(() => {
    const el = ref.current;
    if (!tabs || !el) return;
    const wheel = (e: WheelEvent) => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0 || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      // At either end, let the page scroll on as usual.
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max - 1)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [tabs]);
  return (
    <ChipsKindContext.Provider value={kind}>
      <div
        ref={ref}
        className="chips"
        role={role}
        aria-label={label}
        style={wrap ? { flexWrap: "wrap" } : undefined}
        onScroll={tabs ? update : undefined}
        // Tabs too long for the row fade out at an end that has more, so it reads as scrollable.
        data-more={tabs ? (ends.start ? (ends.end ? undefined : "end") : ends.end ? "start" : "both") : undefined}
      >
        {children}
        {tabs ? <TabInk /> : null}
      </div>
    </ChipsKindContext.Provider>
  );
}

/**
 * The selected text tab's underline, one line that slides to the tab picked. It's placed without
 * moving the first time, so a page opens with it already under its tab.
 */
function TabInk() {
  const ink = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const line = ink.current;
    const row = line?.parentElement;
    if (!line || !row) return;
    const place = () => {
      const tab = row.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!tab) {
        line.style.opacity = "0";
        return;
      }
      line.style.opacity = "1";
      line.style.width = `${tab.offsetWidth}px`;
      line.style.transform = `translateX(${tab.offsetLeft}px)`;
      if (!placed.current) {
        placed.current = true;
        // Reading the layout commits this first position, so only later moves slide.
        void line.offsetWidth;
        line.classList.add("tab-ink-moves");
      }
    };
    place();
    // Fonts arriving or the row resizing move the tabs; follow them.
    const observer = new ResizeObserver(place);
    observer.observe(row);
    const mutations = new MutationObserver(place);
    mutations.observe(row, { attributes: true, subtree: true, attributeFilter: ["aria-selected"] });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, []);
  return <span ref={ink} className="tab-ink" aria-hidden="true" />;
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
  const ref = useRef<HTMLButtonElement>(null);
  const shown = useRef(false);
  // A selected tab past the edge of a row that scrolls comes into view, with room for the fade:
  // straight away when the page opens on it, gliding when it's picked.
  useEffect(() => {
    const el = ref.current;
    const row = el?.parentElement;
    const first = !shown.current;
    shown.current = true;
    if (kind !== "tabs" || !selected || !el || !row || row.scrollWidth <= row.clientWidth) return;
    const fade = 48;
    const left = el.offsetLeft; // the tab row is position: relative, so this is from its start
    const to =
      left - fade < row.scrollLeft
        ? Math.max(0, left - fade)
        : left + el.offsetWidth + fade > row.scrollLeft + row.clientWidth
          ? left + el.offsetWidth + fade - row.clientWidth
          : null;
    if (to !== null) row.scrollTo({ left: to, behavior: first ? "instant" : "smooth" });
  }, [kind, selected]);
  return (
    <button
      ref={ref}
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

/** One settings row: a title with optional sub lines on the left, its value or action on the right. */
export function Setting({ title, sub, children }: { title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="setting">
      <span className="setting-text">
        <span className="setting-title">{title}</span>
        {sub}
      </span>
      {children}
    </div>
  );
}

/** A setting's sub line, red when it's an error. No status dots: a failure is said in red here. */
export function SettingSub({ error, children }: { error?: boolean; children: React.ReactNode }) {
  return <span className={`setting-sub ${error ? "error" : ""}`}>{children}</span>;
}

/** A settings row that opens its own screen, with its current value (or an accent count of what's waiting) and a chevron. */
export function SettingLink({ title, value, badge, href }: { title: string; value?: string | null; badge?: number; href: string }) {
  return (
    <Link href={href} className="setting setting-link">
      <span className="setting-title">{title}</span>
      <span className="setting-value">
        {badge ? <span className="badge-count">{badge}</span> : null}
        {value ? <span>{value}</span> : null}
        <ChevronIcon />
      </span>
    </Link>
  );
}

/** A group of settings rows on You: an eyebrow label over flat rows split by hairlines. */
export function SettingsGroup({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <section className="set-group">
      {label ? <h3 className="eyebrow set-label">{label}</h3> : null}
      {children}
    </section>
  );
}

/** A setting with a few choices: its value and a chevron, which open a sheet to pick from. */
export function ChoiceRow<T extends string | number>({
  title,
  sub,
  value,
  choices,
  onPick,
  disabled,
}: {
  title: string;
  sub?: React.ReactNode;
  value: T;
  choices: ReadonlyArray<{ id: T; label: string }>;
  onPick: (id: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="setting setting-link" disabled={disabled} onClick={() => setOpen(true)}>
        <span className="setting-text">
          <span className="setting-title">{title}</span>
          {sub}
        </span>
        <span className="setting-value">
          <span>{choices.find((c) => c.id === value)?.label}</span>
          <ChevronIcon />
        </span>
      </button>
      <ChoiceSheet
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        choices={choices.map((c) => ({ id: String(c.id), label: c.label }))}
        value={String(value)}
        onPick={(id) => onPick(choices.find((c) => String(c.id) === id)!.id)}
      />
    </>
  );
}

/**
 * A settings row that turns something on or off: "On" in accent or "Off" in muted, lined up with
 * the other rows' values. Leave out `checked` inside a form to read it from FormData.
 */
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
      <span className="switch-state" aria-hidden="true">
        <span className="on">On</span>
        <span className="off">Off</span>
      </span>
    </label>
  );
}

