"use client";

import Link from "next/link";
import { LIBRARY_SECTION_LABELS, librarySections, type LibrarySection } from "@murmur/shared/client";
import { SECTION_HREF, useTabPrefs } from "../shell";

/**
 * Library's title row: the sections side by side at title size, the current one bright and
 * the others dimmed; tap one to switch. With one section left it's a plain title.
 */
export function LibraryTitle({ current }: { current: LibrarySection }) {
  const sections = librarySections(useTabPrefs());
  if (sections.length <= 1) return <h1 className="page-title">{LIBRARY_SECTION_LABELS[current]}</h1>;
  return (
    <nav className="library-title" aria-label="Library">
      {sections.map((s) =>
        s === current ? (
          <h1 key={s} className="page-title">
            {LIBRARY_SECTION_LABELS[s]}
          </h1>
        ) : (
          <Link key={s} href={SECTION_HREF[s]} className="page-title">
            {LIBRARY_SECTION_LABELS[s]}
          </Link>
        ),
      )}
    </nav>
  );
}
