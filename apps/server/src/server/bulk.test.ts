import { expect, it } from "vitest";
import { bulkChanges, bulkForm, bulkStart, pickRange } from "@murmur/shared";

const order = ["a", "b", "c", "d", "e"];

it("shift-picks the run between the last pick and this one, either way", () => {
  expect([...pickRange(order, new Set(["b"]), "b", "d")].sort()).toEqual(["b", "c", "d"]);
  expect([...pickRange(order, new Set(["d"]), "d", "a")].sort()).toEqual(["a", "b", "c", "d"]);
});

it("toggles just the one without an anchor in the list", () => {
  expect([...pickRange(order, new Set(["a"]), null, "c")].sort()).toEqual(["a", "c"]);
  expect([...pickRange(order, new Set(["a", "c"]), "gone", "c")]).toEqual(["a"]);
});

it("shows shared values and Mixed where books differ", () => {
  const start = bulkStart([
    { author: "Brandon Sanderson", narrator: "Michael Kramer", series: "Stormlight" },
    { author: "Brandon Sanderson ", narrator: "Kate Reading", series: "Stormlight" },
  ]);
  expect(start).toEqual({ author: "Brandon Sanderson", narrator: null, series: "Stormlight" });
  expect(bulkForm(start)).toEqual({ author: "Brandon Sanderson", narrator: "", series: "Stormlight" });
});

it("only saves fields typed differently, and a blank Mixed field keeps each book's own", () => {
  const start = { author: "A", narrator: null, series: "S" };
  expect(bulkChanges(start, { author: "A", narrator: "", series: "S" })).toEqual({});
  expect(bulkChanges(start, { author: "B", narrator: "N", series: "" })).toEqual({ author: "B", narrator: "N", series: "" });
});
