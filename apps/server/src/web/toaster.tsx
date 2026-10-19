"use client";

import { Toaster as Sonner } from "sonner";

/**
 * Short confirmations ("Marked as finished") and failures. Slides down from the top and
 * settles just under the row of back/menu buttons, in the theme's colours.
 */
export function Toaster() {
  return (
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
  );
}
