import { expect, it } from "vitest";
import { scanShare, scanStatusText, type ScanStatusDto } from "@murmur/shared";
import { addToScan, counted, createScanState } from "./library/scan-loop";

const running = (progress: ScanStatusDto["progress"]): ScanStatusDto => ({ running: true, lastFinishedAt: null, lastError: null, progress });

it("says how far a scan is, in the kind's own word", () => {
  expect(scanStatusText(running({ done: 412, total: 1210 }), "music")).toBe("Scanning, 412 of 1,210 songs");
  expect(scanStatusText(running({ done: 0, total: 1 }), "books")).toBe("Scanning, 0 of 1 book");
  // Still walking the folders, or an older server with no progress.
  expect(scanStatusText(running(null), "watch")).toBe("Scanning now");
  expect(scanStatusText(running(undefined), "watch")).toBe("Scanning now");
});

it("fills the bar only while running with something found", () => {
  expect(scanShare(running({ done: 1, total: 4 }))).toBe(0.25);
  expect(scanShare(running({ done: 0, total: 0 }))).toBeNull();
  expect(scanShare({ ...running({ done: 4, total: 4 }), running: false })).toBeNull();
});

it("counts each item once however its import ends, as folders add to the total", async () => {
  const state = createScanState();
  addToScan(state, 2);
  await Promise.all([1, 2].map(counted(state, async (n: number) => {
    if (n === 2) throw new Error("unreadable");
  })).map((p) => p.catch(() => undefined)));
  addToScan(state, 3);
  expect(state.progress).toEqual({ done: 2, total: 5 });
});
