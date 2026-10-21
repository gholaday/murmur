import { expect, it } from "vitest";
import { isNewer } from "./updates";

it("compares release versions number by number", () => {
  expect(isNewer("0.2.7", "0.2.6")).toBe(true);
  expect(isNewer("v0.2.10", "0.2.9")).toBe(true); // not compared as text
  expect(isNewer("1.0.0", "0.9.9")).toBe(true);
  expect(isNewer("0.2.6", "0.2.6")).toBe(false);
  expect(isNewer("0.2.5", "0.2.6")).toBe(false);
  expect(isNewer("0.3.0", "dev")).toBe(false);
});
