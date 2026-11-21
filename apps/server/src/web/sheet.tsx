"use client";

import { useEffect, useRef, useState } from "react";
import { CountPill } from "./ui";

/**
 * A bottom sheet on phones and a centred dialog on wide screens, built on <dialog>
 * so focus trapping, Escape and the backdrop come from the browser.
 */
export function Sheet({
  open,
  onClose,
  title,
  count,
  sub,
  action,
  className,
  art,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Extra classes on the dialog, like `confirm`. */
  className?: string;
  /** Pictures above the title, like the covers a confirm is about. */
  art?: React.ReactNode;
  /** A grey count beside the title. */
  count?: number;
  /** A muted line under the title. */
  sub?: React.ReactNode;
  /** A button at the right of the title row. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { dialogProps, drag, sinking } = useSheetDialog({ open, onClose });
  // While it sinks, it keeps what it showed when open: callers often clear their state on close,
  // which would otherwise empty the sheet or change its title on the way out.
  const shown = useRef({ title, count, sub, action, art, children });
  if (open) shown.current = { title, count, sub, action, art, children };
  else if (sinking) ({ title, count, sub, action, art, children } = shown.current);
  return (
    <dialog className={`sheet ${className ?? ""}`} aria-label={title} {...dialogProps}>
      <div className="sheet-body">
        <div className="sheet-grab" aria-hidden="true" {...drag} />
        <div className="sheet-head" {...drag}>
          {art}
          <div>
            <div className="sheet-title">
              {title}
              {count ? <CountPill count={count} /> : null}
            </div>
            {sub ? <div className="page-sub">{sub}</div> : null}
          </div>
          {action}
        </div>
        <div className="sheet-scroll">{open || sinking ? children : null}</div>
      </div>
    </dialog>
  );
}

/**
 * What makes a <dialog> a sheet: it opens as a modal, and on a phone drags down to close by its grab
 * bar (`drag` goes on `.sheet-grab` and the title row). The person closing it (Escape, the backdrop,
 * a drag, `dismiss`) sinks it away first and then calls onClose, so it works the same for a sheet
 * mounted only while it's open. `open` turning false sinks it too, without calling onClose.
 */
export function useSheetDialog({ open = true, onClose }: { open?: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Closing because `open` turned false isn't the person closing it, so onClose stays quiet.
  const openRef = useRef(open);
  // What's inside stays while the sheet sinks away, so it doesn't sink empty.
  const [sinking, setSinking] = useState(false);
  useEffect(() => {
    openRef.current = open;
    const el = ref.current;
    if (!el) return;
    if (open) {
      // Also when it's opened again while still sinking.
      el.classList.remove("sheet-closing");
      el.style.transform = "";
      el.style.removeProperty("--sheet-fade");
      if (!el.open) el.showModal();
    }
    if (!open && el.open) {
      setSinking(true);
      sinkThenClose(el, () => setSinking(false));
    }
  }, [open]);
  // Set while the person's close plays out, so onClose is called once, after the sink.
  const dismissing = useRef(false);
  const dismiss = () => {
    const el = ref.current;
    if (!el?.open || el.classList.contains("sheet-closing")) return;
    dismissing.current = true;
    sinkThenClose(el, () => {
      dismissing.current = false;
      if (openRef.current) onClose();
    });
  };
  const backdropClose = useBackdropClose(dismiss);
  const drag = useSheetDrag(ref, dismiss);
  const dialogProps = {
    ref,
    // Closed some other way (a form's method="dialog"): tell the caller.
    onClose: () => openRef.current && !dismissing.current && onClose(),
    onCancel: (e: React.SyntheticEvent) => {
      e.preventDefault();
      dismiss();
    },
    ...backdropClose,
  };
  return { dialogProps, drag, dismiss, sinking };
}

/** How long a sheet takes to sink away, matching `.sheet-closing` in sheet.css. */
const SINK_MS = 180;
/** A drag past this share of the sheet's height closes it on release. */
const DRAG_CLOSE_SHARE = 0.3;
/** Or a flick down faster than this, in px per ms. */
const DRAG_CLOSE_SPEED = 0.5;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Plays the sheet's sink and backdrop fade, then closes the <dialog>; `done` runs once it's shut. */
function sinkThenClose(el: HTMLDialogElement, done: () => void) {
  if (reducedMotion()) {
    el.close();
    return done();
  }
  el.classList.add("sheet-closing");
  window.setTimeout(() => {
    // Opened again while sinking: leave it open.
    if (!el.classList.contains("sheet-closing")) return done();
    el.classList.remove("sheet-closing");
    el.style.transform = "";
    el.style.removeProperty("--sheet-fade");
    if (el.open) el.close();
    done();
  }, SINK_MS);
}

/**
 * On a phone, a sheet follows a drag down from its grab bar or title row, with its backdrop
 * fading as it goes. Let go past a third of the way, or with a flick, and it closes; otherwise
 * it springs back.
 */
function useSheetDrag(ref: React.RefObject<HTMLDialogElement | null>, onClose: () => void) {
  const start = useRef<{ y: number; t: number; id: number } | null>(null);
  const last = useRef({ y: 0, t: 0 });
  const move = (dy: number) => {
    const el = ref.current;
    if (!el) return;
    const d = Math.max(0, dy);
    el.style.transform = d ? `translateY(${d}px)` : "";
    el.style.setProperty("--sheet-fade", String(1 - Math.min(1, d / el.offsetHeight)));
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (!window.matchMedia("(max-width: 699px)").matches || (e.target as HTMLElement).closest("button, a, input")) return;
      start.current = { y: e.clientY, t: e.timeStamp, id: e.pointerId };
      last.current = { y: e.clientY, t: e.timeStamp };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      ref.current?.classList.add("sheet-dragging");
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current?.id !== e.pointerId) return;
      last.current = { y: e.clientY, t: e.timeStamp };
      move(e.clientY - start.current.y);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      const el = ref.current;
      start.current = null;
      if (!s || s.id !== e.pointerId || !el) return;
      el.classList.remove("sheet-dragging");
      const dy = e.clientY - s.y;
      const speed = (e.clientY - last.current.y) / Math.max(1, e.timeStamp - last.current.t);
      if (dy > el.offsetHeight * DRAG_CLOSE_SHARE || (dy > 10 && speed > DRAG_CLOSE_SPEED)) onClose();
      else move(0);
    },
    onPointerCancel: () => {
      start.current = null;
      ref.current?.classList.remove("sheet-dragging");
      move(0);
    },
  };
}

/**
 * Handlers that close a <dialog> on a backdrop click. The press has to start on the
 * backdrop too, so selecting text and letting go outside the dialog doesn't close it.
 */
export function useBackdropClose(onClose: () => void) {
  const downOnBackdrop = useRef(false);
  return {
    onPointerDown: (e: React.PointerEvent<HTMLDialogElement>) => {
      downOnBackdrop.current = e.target === e.currentTarget;
    },
    onClick: (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === e.currentTarget && downOnBackdrop.current) onClose();
      downOnBackdrop.current = false;
    },
  };
}

/** Pick one of a few choices, like a sort; picking closes it. */
export function ChoiceSheet<T extends string>({
  open,
  onClose,
  title,
  choices,
  value,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  choices: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onPick: (id: T) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {choices.map((c) => (
        <SheetItem
          key={c.id}
          active={value === c.id}
          onClick={() => {
            onPick(c.id);
            onClose();
          }}
        >
          {c.label}
        </SheetItem>
      ))}
    </Sheet>
  );
}

/**
 * Asks before something can't be undone: a title, a line on what happens if it isn't plain, then
 * the action and Cancel, as in the app. On a phone it's centred with the action full width over
 * Cancel; on a wide screen it's a small dialog with Cancel and the action on the right.
 */
export function ConfirmSheet({
  open,
  title,
  message,
  confirmLabel,
  danger = true,
  busy,
  art,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  /** Covers stacked above the title, for what's being removed. */
  art?: React.ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} className="confirm" art={art ? <div className="confirm-art">{art}</div> : null}>
      {message ? <p className="muted confirm-line">{message}</p> : null}
      <div className="confirm-actions">
        <button type="button" className={`btn btn-big ${danger ? "btn-danger-fill" : "btn-primary"}`} disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="btn btn-big confirm-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

/** A full-width row button inside a sheet. */
export function SheetItem({
  children,
  onClick,
  active,
  danger,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`sheet-item ${danger ? "danger" : ""}`}
      aria-current={active || undefined}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
