import { useEffect, useMemo, useRef } from "react";
import { type LibrarySection, storageKeys } from "@murmur/shared/client";
import { createSavedStore, createStore } from "./store";

/** The Library section open, kept for next time. */
export const librarySection = createSavedStore<LibrarySection>(storageKeys.librarySection, "books");

// Taps on each title-row name. Library jumps straight to the section, and the section fades its
// content in (a swipe follows the finger instead).
const jumps = createStore<Record<LibrarySection, number>>({ books: 0, music: 0, watch: 0 });

/** Opens a section from the title row. */
export function jumpToSection(s: LibrarySection) {
  jumps.set({ ...jumps.get(), [s]: jumps.get()[s] + 1 });
  librarySection.set(s);
}

/** How many times this section has been tapped to; a change fades its content in. */
export const useSectionJumps = (s: LibrarySection) => jumps.useValue()[s];

/** On while a section needs sideways drags for itself (Books' Customize), so Library doesn't swipe. */
export const librarySwipeLocked = createStore(false);

// A finger on a shelf: Library holds still so the shelf scrolls instead. Set straight on the
// pager, not through a render, so it lands before the pager takes the drag.
let holdPager: ((held: boolean) => void) | null = null;

/** Library's pager listens here while it's open. */
export function onShelfTouch(fn: ((held: boolean) => void) | null) {
  holdPager = fn;
}

/**
 * Touch handlers for a sideways list inside Library (a shelf, tabs that overflow). One that goes
 * away mid-touch lets go of the pager too.
 */
export function useShelfTouch() {
  const holding = useRef(false);
  useEffect(
    () => () => {
      if (holding.current) holdPager?.(false);
    },
    [],
  );
  return useMemo(() => {
    const release = () => {
      holding.current = false;
      holdPager?.(false);
    };
    const onTouchStart = () => {
      holding.current = true;
      holdPager?.(true);
    };
    return { onTouchStart, onTouchEnd: release, onTouchCancel: release };
  }, []);
}
