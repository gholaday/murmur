"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerItem } from "./video-player";

interface VideoSession {
  item: PlayerItem | null;
  /** Pressed Play to get here, so it starts on its own; a reload or a pasted link waits for you. */
  autoplay: boolean;
  open: (item: PlayerItem) => void;
  close: () => void;
}

const VideoContext = createContext<VideoSession | null>(null);

/** The video being watched, kept above the pages so it plays on in the mini player. */
export function VideoProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ item: PlayerItem | null; autoplay: boolean }>({ item: null, autoplay: false });
  // True once you've moved between pages here: a player reached that way was asked for, one on first load wasn't.
  const pathname = usePathname();
  const navigated = useRef(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else navigated.current = true;
  }, [pathname]);
  // Opening what's already on (back to the player from the mini player) carries on where it is.
  const open = useCallback(
    (next: PlayerItem) =>
      setState((cur) => (cur.item && cur.item.progressId === next.progressId && cur.item.src === next.src ? cur : { item: next, autoplay: navigated.current })),
    [],
  );
  const close = useCallback(() => setState({ item: null, autoplay: false }), []);
  const value = useMemo(() => ({ ...state, open, close }), [state, open, close]);
  return <VideoContext.Provider value={value}>{children}</VideoContext.Provider>;
}

export function useVideo(): VideoSession {
  const session = useContext(VideoContext);
  if (!session) throw new Error("useVideo outside VideoProvider");
  return session;
}

/** Rendered by the play route: puts its video in the player, which the shell shows full screen there. */
export function OpenVideo({ item }: { item: PlayerItem }) {
  const { open } = useVideo();
  useEffect(() => open(item), [open, item]);
  return null;
}
