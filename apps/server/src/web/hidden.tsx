"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiPaths, errorText, type HiddenChange } from "@murmur/shared/client";
import { api } from "./api";
import { MenuItem, MenuSep } from "./card-menu";

/** Sent on window when something is hidden or shown again, for lists the page holds itself (Search). */
export const HIDDEN_CHANGED = "murmur:hidden";

/** A detail page's way out once its item is hidden: back, or to `fallback` when it was opened on its own. */
export function useLeave() {
  const router = useRouter();
  return (fallback: string) => () => (window.history.length > 1 ? router.back() : router.replace(fallback));
}

/** Hides or shows again a book, album, artist, movie or show, then refreshes the page's lists. */
export function useHidden() {
  const router = useRouter();
  const send = async (hide: boolean, change: HiddenChange): Promise<boolean> => {
    try {
      await api(apiPaths.hidden, { method: hide ? "PUT" : "DELETE", body: change });
      router.refresh();
      window.dispatchEvent(new Event(HIDDEN_CHANGED));
      return true;
    } catch (err) {
      toast.error(errorText(err, hide ? "Couldn't hide that." : "Couldn't unhide that."));
      return false;
    }
  };
  return {
    unhide: (change: HiddenChange) => send(false, change),
    /** Hides it, with an Undo toast; `after` runs once it's hidden (a detail page goes back). */
    hide: async (change: HiddenChange, title: string, after?: () => void) => {
      if (!(await send(true, change))) return;
      after?.();
      toast(`Hid ${title}`, { duration: 5000, action: { label: "Undo", onClick: () => void send(false, change) } });
    },
  };
}

/** The last item of a ⋯ menu: Hide, after a divider. */
export function HideMenuItem({ change, title, choose, after, divider = true }: {
  change: HiddenChange;
  title: string;
  choose: (fn: () => unknown) => () => void;
  after?: () => void;
  /** Off when Hide is the menu's only item. */
  divider?: boolean;
}) {
  const { hide } = useHidden();
  return (
    <>
      {divider ? <MenuSep /> : null}
      <MenuItem onClick={choose(() => hide(change, title, after))}>Hide</MenuItem>
    </>
  );
}
