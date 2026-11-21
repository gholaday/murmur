"use client";

import { type ExternalToast, toast as sonner } from "sonner";

/** Undo, Open: one thing to do about what just happened. */
interface ToastAction {
  label: string;
  onClick: () => void;
}

let next = 0;

/**
 * Sonner's toast, but its action is ours: accent text (`.text-btn`), as in the app. Sonner's own
 * action button is a pill, so a toast with an action gets this button instead, and stays up long
 * enough to reach it.
 */
function show(message: React.ReactNode, options?: Omit<ExternalToast, "action"> & { action?: ToastAction }) {
  if (!options?.action) return sonner(message, options);
  const { action, ...rest } = options;
  const id = rest.id ?? `action-${++next}`;
  return sonner(message, {
    duration: 5000,
    ...rest,
    id,
    action: (
      <button
        type="button"
        className="text-btn toast-action"
        onClick={() => {
          sonner.dismiss(id);
          action.onClick();
        }}
      >
        {action.label}
      </button>
    ),
  });
}

export const toast = Object.assign(show, { error: sonner.error, dismiss: sonner.dismiss });
