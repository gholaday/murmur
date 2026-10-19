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
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet-body">
        <div className="sheet-title">{title}</div>
        {open ? children : null}
      </div>
    </dialog>
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
