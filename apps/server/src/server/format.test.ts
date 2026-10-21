import { expect, it } from "vitest";
import { clock, duration, shortDate, timeLeft } from "@murmur/shared/client";

it("shows positions as a clock", () => {
  expect(clock(0)).toBe("0:00");
  expect(clock(65.9)).toBe("1:05");
  expect(clock(3723)).toBe("1:02:03");
  expect(clock(-5)).toBe("0:00");
});

it("shows lengths in hours and minutes", () => {
  expect(duration(null)).toBe("");
  expect(duration(25)).toBe("25s");
  expect(duration(42 * 60)).toBe("42m");
  expect(duration(2 * 3600)).toBe("2h");
  expect(duration(16 * 3600 + 10 * 60)).toBe("16h 10m");
  expect(timeLeft(3600, 3600)).toBe("0m left");
  expect(timeLeft(3600, 600)).toBe("50m left");
});

it("says Today and Yesterday by calendar day, across a daylight saving change", () => {
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
  expect(shortDate(at(2026, 10, 20, 1), at(2026, 10, 20, 23))).toBe("Today");
  expect(shortDate(at(2026, 10, 19, 23), at(2026, 10, 20, 1))).toBe("Yesterday");
  // Clocks go back on 1 November in the US and 25 October in Europe; both days are covered.
  expect(shortDate(at(2026, 10, 31), at(2026, 11, 1, 23))).toBe("Yesterday");
  expect(shortDate(at(2026, 11, 1), at(2026, 11, 2, 0))).toBe("Yesterday");
  expect(shortDate(at(2026, 10, 24), at(2026, 10, 25, 23))).toBe("Yesterday");
  expect(shortDate(at(2026, 10, 25), at(2026, 10, 26, 0))).toBe("Yesterday");
});
