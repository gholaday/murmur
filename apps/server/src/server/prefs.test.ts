import { BOOK_SECTION_IDS, bookSections } from "@murmur/shared";
import { expect, it } from "vitest";

it("fills in a missing layout with every section shown, in the default order", () => {
  expect(bookSections(undefined)).toEqual(BOOK_SECTION_IDS.map((id) => ({ id, hidden: false })));
});

it("keeps the saved order, drops unknown and repeated sections, and adds new ones at the end", () => {
  const saved = [
    { id: "all", hidden: true },
    { id: "gone", hidden: false },
    { id: "added", hidden: false },
    { id: "all", hidden: false },
  ] as Parameters<typeof bookSections>[0];
  expect(bookSections(saved)).toEqual([
    { id: "all", hidden: true },
    { id: "added", hidden: false },
    { id: "continue", hidden: false },
    { id: "next", hidden: false },
    { id: "unstarted", hidden: false },
  ]);
});
