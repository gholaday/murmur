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
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropClose = useBackdropClose(onClose);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet" aria-label={title} onClose={onClose} {...backdropClose}>
      <div className="sheet-body">
        <div className="sheet-title">{title}</div>
        {open ? children : null}
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
