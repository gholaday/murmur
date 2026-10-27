// Series suggestions in the edit dialog (packages/shared).
import { suggestSeries } from "@murmur/shared/client";
import { expect, it } from "vitest";

const known = [{ name: "The Stormlight Archive" }, { name: "Mistborn: Era 1" }, { name: "Storm Front" }, { name: "Dune" }];
const names = (typed: string) => suggestSeries(known, typed).map((s) => s.name);

it("matches anywhere, ignoring case and punctuation, word starts first", () => {
  expect(names("storm")).toEqual(["The Stormlight Archive", "Storm Front"]);
  expect(names("mistborn era")).toEqual(["Mistborn: Era 1"]);
  expect(names("orml")).toEqual(["The Stormlight Archive"]);
});

it("leaves out the name typed exactly, but offers the library's spelling of a near one", () => {
  expect(names("Dune")).toEqual([]);
  expect(names("dune")).toEqual(["Dune"]);
  expect(names("  ")).toEqual([]);
});
