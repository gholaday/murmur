"use client";

import { useEffect, useRef } from "react";
import { Toaster as Sonner } from "sonner";

/**
 * Short confirmations ("Marked as finished") and failures. Slides down from the top and
 * settles just under the row of back/menu buttons, in the theme's colours.
 *
 * An open <dialog> sits in the browser's top layer, above everything else whatever its
 * z-index, so toasts would hide behind sheets and the edit dialog. The toaster is a popover
 * instead, also in the top layer, and is shown again whenever a dialog opens so it stays the
 * newest entry, which is drawn on top.
 */
export function Toaster() {
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = layer.current;
    if (!el || !("showPopover" in el)) return;
    const raise = () => {
      if (el.matches(":popover-open")) el.hidePopover();
      el.showPopover();
    };
    raise();
    const watch = new MutationObserver((changes) => {
      if (changes.some((c) => c.target instanceof HTMLDialogElement && c.target.open)) raise();
    });
    watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    return () => watch.disconnect();
  }, []);

  return (
    <div ref={layer} popover="manual" className="toast-layer">
      <Sonner
        position="top-center"
        offset={{ top: 66 }}
        mobileOffset={{ top: "calc(env(safe-area-inset-top) + 66px)" }}
        duration={2500}
        gap={8}
        toastOptions={{ className: "toast" }}
        style={
          {
            "--normal-bg": "var(--surface-2)",
            "--normal-text": "var(--text)",
            "--normal-border": "var(--line)",
            "--error-bg": "var(--surface-2)",
            "--error-text": "var(--danger)",
            "--error-border": "var(--line)",
            "--border-radius": "14px",
            fontFamily: "inherit",
          } as React.CSSProperties
        }
      />
    </div>
  );
}
