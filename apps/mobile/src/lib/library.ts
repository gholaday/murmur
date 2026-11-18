import { type LibrarySection, storageKeys } from "@murmur/shared/client";
import { createSavedStore, createStore } from "./store";

/** The Library section open, kept for next time. */
export const librarySection = createSavedStore<LibrarySection>(storageKeys.librarySection, "books");

// Taps on each title-row name. Library shows the section, and the section fades its content in.
const jumps = createStore<Record<LibrarySection, number>>({ books: 0, music: 0, watch: 0 });

/** Opens a section from the title row. */
export function jumpToSection(s: LibrarySection) {
  jumps.set({ ...jumps.get(), [s]: jumps.get()[s] + 1 });
  librarySection.set(s);
}

/** How many times this section has been tapped to; a change fades its content in. */
export const useSectionJumps = (s: LibrarySection) => jumps.useValue()[s];
