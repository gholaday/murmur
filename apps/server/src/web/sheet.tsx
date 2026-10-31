"use client";

import { useEffect, useRef } from "react";

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
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
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
    <dialog ref={ref} className="sheet" aria-label={title} onClose={() => openRef.current && onClose()} {...backdropClose}>
      <div className="sheet-body">
        <div className="sheet-head">
          <div>
            <div className="sheet-title">
              {title}
              {count ? <span className="count-pill">{count}</span> : null}
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

/** A full-width row button inside a sheet. */
/** Asks before something can't be undone: a title, one line on what happens, then Cancel and the action, as in the app. */
export function ConfirmSheet({
  open,
  title,
  message,
  confirmLabel,
  danger = true,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p className="muted" style={{ margin: 0 }}>
        {message}
      </p>
      <div className="form-row">
        <button type="button" className="btn" style={{ flex: 1 }} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={`btn ${danger ? "btn-danger" : "btn-primary"}`} style={{ flex: 1 }} disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

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
