import { expect, it } from "vitest";
import { parseRange } from "@murmur/shared";

it("parses the byte ranges audio players send", () => {
  expect(parseRange(null, 1000)).toBeNull();
  expect(parseRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
  expect(parseRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
  expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
  expect(parseRange("bytes=0-1,5-6", 1000)).toBeNull(); // multi-range: serve the whole file
});
