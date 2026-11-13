"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { storageKeys } from "@murmur/shared/client";
import { CloseIcon } from "../icons";
import { getJson, setJson } from "../storage";
import { Chip, Chips, CountPill } from "../ui";
import { UpNextList, useQueueHead } from "../up-next";
import { type Playable, usePlayerSelect } from "./engine";
import { NowBookmarks, NowChapters } from "./now-lists";

type PanelTab ="upnext" | "chapters" | "bookmarks";
const TABS: ReadonlyArray<{ id: PanelTab; label: string }> = [
  { id: "upnext", label: "Queue" },
  { id: "chapters", label: "Chapters" },
  { id: "bookmarks", label: "Bookmarks" },
];

// ---------- Open and tab, remembered in this browser ----------

interface SidePanel {
  open: boolean;
  tab: PanelTab;
}

/**
 * From this width the panel is a column that pushes the page, and starts open; narrower (down to
 * the wide layout's 900px) it floats over the page and starts closed. player.css says the same.
 */
const ROOMY = "(min-width: 1200px)";

let saved: SidePanel | null | undefined;
const listeners = new Set<() => void>();

function load(): SidePanel | null {
  if (saved === undefined) {
    const s = getJson<SidePanel>(storageKeys.sidePanel);
    saved = s && typeof s.open === "boolean" && TABS.some((t) => t.id === s.tab) ? s : null;
  }
  return saved;
}

function save(next: SidePanel) {
  saved = next;
  setJson(storageKeys.sidePanel, next);
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function subscribeRoomy(onChange: () => void) {
  const query = window.matchMedia(ROOMY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** The window is wide enough for the panel to sit beside the page. */
function useRoomy(): boolean {
  return useSyncExternalStore(
    subscribeRoomy,
    () => window.matchMedia(ROOMY).matches,
    () => false,
  );
}

/** The tabs that apply to what's playing: a song has only its queue, and one chapter isn't a list. */
function tabsFor(item: Playable): PanelTab[] {
  if (item.type === "track") return ["upnext"];
  return item.chapters.length > 1 ? ["upnext", "chapters", "bookmarks"] : ["upnext", "bookmarks"];
}

/**
 * Whether the side panel shows and on which tab. A remembered tab that doesn't apply to what's
 * playing shows the queue, but stays remembered for the next thing that has it.
 */
export function useSidePanel(item: Playable | null) {
  const s = useSyncExternalStore(subscribe, load, () => null);
  const roomy = useRoomy();
  const open = s?.open ?? roomy;
  const remembered = s?.tab ?? "chapters";
  const tabs = item ? tabsFor(item) : [];
  const tab = tabs.includes(remembered) ? remembered : "upnext";
  return {
    open: open && !!item,
    tab,
    tabs,
    roomy,
    /** Shows a tab, or closes the panel if it's already showing it. */
    toggle: (to: PanelTab) => (open && tab === to ? closePanel() : showTab(to)),
  };
}

const showTab = (tab: PanelTab) => save({ open: true, tab });
// Closing keeps the tab remembered, even one that what's playing doesn't have.
const closePanel = () => save({ open: false, tab: load()?.tab ?? "chapters" });

// ---------- The panel ----------

/**
 * On wide screens, a column on the right of the page with what's playing's queue, chapters and
 * bookmarks; the player bar's Chapters and Queue buttons open it on their tab. From 1200px it
 * pushes the page; narrower it floats over it, and Escape or a click outside closes it.
 */
export function SidePanel() {
  const item = usePlayerSelect((p) => p.item);
  const panel = useSidePanel(item);
  const ref = useRef<HTMLElement>(null);
  const floating = panel.open && !panel.roomy;

  useEffect(() => {
    if (!floating) return;
    // A sheet or a toast over the page, or the bar's own buttons for the panel, aren't outside it.
    const keep = (t: EventTarget | null) => t instanceof Element && (ref.current?.contains(t) || t.closest("dialog[open], [data-sonner-toaster], [data-panel-toggle]"));
    const onDown = (e: PointerEvent) => {
      if (!keep(e.target)) closePanel();
    };
    const onKey = (e: KeyboardEvent) => {
      // A sheet or a speed popover takes Escape first, and Now playing under the panel waits for the next one.
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open], .speed-pop")) return;
      e.preventDefault();
      closePanel();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [floating]);

  if (!item || !panel.open) return null;
  const songOnly = panel.tabs.length === 1;
  return (
    <aside ref={ref} className="shell-panel side-panel" aria-label={songOnly ? "Queue" : "Now playing details"}>
      {songOnly ? (
        <QueueHead />
      ) : (
        <div className="side-panel-head side-panel-tabs">
          <Chips kind="tabs" label="Queue, chapters or bookmarks">
            {TABS.filter((t) => panel.tabs.includes(t.id)).map((t) => (
              <Chip key={t.id} selected={panel.tab === t.id} onClick={() => showTab(t.id)}>
                {t.label}
              </Chip>
            ))}
          </Chips>
          <CloseButton />
        </div>
      )}
      <div className="side-panel-scroll">
        <div key={panel.tab} className="view-fade">
          {panel.tab === "chapters" ? <NowChapters /> : panel.tab === "bookmarks" ? <NowBookmarks /> : <PanelQueue titled={songOnly} />}
        </div>
      </div>
    </aside>
  );
}

function CloseButton() {
  return (
    <button type="button" className="icon-btn" onClick={closePanel} aria-label="Close panel">
      <CloseIcon />
    </button>
  );
}

/** A song's panel is only its queue, titled like the Queue sheet. */
function QueueHead() {
  const { waiting, from, clear } = useQueueHead();
  return (
    <div className="side-panel-head">
      <div className="side-panel-title">
        <div className="sheet-title">
          Queue
          {waiting ? <CountPill count={waiting} /> : null}
        </div>
        {from ? <div className="page-sub">{from}</div> : null}
      </div>
      {clear}
      <CloseButton />
    </div>
  );
}

/**
 * The queue, opened on the item playing. Under the tabs, which can't hold a title or a count,
 * a line with where it came from, how many are waiting and Clear leads the list.
 */
function PanelQueue({ titled }: { titled: boolean }) {
  const loaded = usePlayerSelect((p) => p.upNextLoaded);
  const playingRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    playingRow.current?.scrollIntoView({ block: "center" });
  }, [loaded]);
  return (
    <>
      {titled ? null : <QueueLine />}
      <UpNextList playingRowRef={playingRow} />
    </>
  );
}

function QueueLine() {
  const { waiting, from, clear } = useQueueHead();
  if (!waiting && !from) return null;
  return (
    <div className="side-panel-line">
      <span className="side-panel-from">
        <span className="page-sub">{from ?? "Up next"}</span>
        {waiting ? <CountPill count={waiting} noun="waiting" /> : null}
      </span>
      {clear}
    </div>
  );
}
