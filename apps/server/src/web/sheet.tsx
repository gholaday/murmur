"use client";

import { useEffect, useRef } from "react";
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
  const ref = useRef<HTMLDialogElement>(null);
  const backdropClose = useBackdropClose(onClose);
  // Closing because `open` turned false isn't the person closing it, so onClose stays quiet.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`sheet ${className ?? ""}`} aria-label={title} onClose={() => openRef.current && onClose()} {...backdropClose}>
      <div className="sheet-body">
        <div className="sheet-head">
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
        <div className="sheet-scroll">{open ? children : null}</div>
      </div>
    </dialog>
  );
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
