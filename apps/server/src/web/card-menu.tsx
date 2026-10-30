"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { errorText } from "@murmur/shared/client";
import { MoreIcon } from "./icons";
import { Sheet, SheetItem } from "./sheet";

const MENU_WIDTH = 220;

/**
 * A card's options menu, the same for books, albums, movies and shows: the ⋯ in its corner or a
 * right-click anywhere on the card opens it, like a long press in the app. `items` is mounted only
 * while it's open, so a closed menu never re-renders with the player.
 */
export function CardMenu({ label, items }: { label: string; items: (choose: (fn: () => unknown) => () => void) => React.ReactNode }) {
  // Where the menu sits on screen. It's rendered into <body> so a scrolling shelf doesn't clip it.
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  const open = pos !== null;
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  /**
   * Right-aligned to the dots (or at the pointer), opening upward low on the page. It never starts
   * left of its card, so the first card's menu doesn't slide under the sidebar.
   */
  const openAt = (x: number, top: number, bottom: number) => {
    const cardLeft = wrap.current?.closest(".card")?.getBoundingClientRect().left ?? 8;
    const left = Math.max(cardLeft, 8, Math.min(x - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    const up = bottom > window.innerHeight * 0.55;
    setPos(up ? { left, bottom: window.innerHeight - top + 6 } : { left, top: bottom + 6 });
  };
  const toggle = () => {
    const r = wrap.current?.getBoundingClientRect();
    if (open || !r) return setPos(null);
    openAt(r.right, r.top, r.bottom);
  };

  // A right-click on the card opens it at the pointer.
  useEffect(() => {
    const card = wrap.current?.closest(".card");
    if (!card) return;
    const onContext = (e: Event) => {
      const m = e as MouseEvent;
      m.preventDefault();
      openAt(m.clientX + MENU_WIDTH, m.clientY, m.clientY);
    };
    card.addEventListener("contextmenu", onContext);
    return () => card.removeEventListener("contextmenu", onContext);
  }, []);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!wrap.current?.contains(t) && !menu.current?.contains(t)) setPos(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPos(null);
    };
    const close = () => setPos(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    // The menu is fixed, so it would drift away from its card on scroll.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const choose = (fn: () => unknown) => () => {
    setPos(null);
    void Promise.resolve(fn()).catch((err: unknown) => toast.error(errorText(err)));
  };

  return (
    <div className="card-menu" ref={wrap}>
      <button type="button" className="card-dots" aria-label={`Options for ${label}`} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        <MoreIcon size={18} />
      </button>
      {pos
        ? createPortal(
            <div ref={menu} className="menu" role="menu" aria-label={`${label} options`} style={{ top: "auto", ...pos, position: "fixed", right: "auto", width: MENU_WIDTH }}>
              {items(choose)}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** Whether menu items are drawn in a page's sheet rather than a card's dropdown. */
const InSheet = createContext(false);

/**
 * An item page's ⋯ menu: the same items as its card's menu, in a sheet. `choose` closes the sheet
 * before acting, as the card menu does.
 */
export function MenuSheet({
  open,
  onClose,
  title,
  items,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  items: (choose: (fn: () => unknown) => () => void) => React.ReactNode;
}) {
  const choose = (fn: () => unknown) => () => {
    onClose();
    void Promise.resolve(fn()).catch((err: unknown) => toast.error(errorText(err)));
  };
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <InSheet.Provider value>{open ? items(choose) : null}</InSheet.Provider>
    </Sheet>
  );
}

export function MenuItem({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  if (useContext(InSheet)) {
    return (
      <SheetItem onClick={onClick} danger={danger}>
        {children}
      </SheetItem>
    );
  }
  return (
    <button type="button" role="menuitem" className={danger ? "danger" : undefined} onClick={onClick}>
      {children}
    </button>
  );
}

export const MenuSep = () => <div className="menu-sep" role="separator" />;
