import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { ADDON_SECRET_MIN_LENGTH, ADSCAN_LIMITS } from "@murmur/shared";

// The ad detection add-on is Python, so it can't import Murmur's rules. It keeps its copy in one
// block at the top of adscan.py; this checks that copy against Murmur's.

const source = fs.readFileSync(path.resolve(__dirname, "../../../../addons/adscan/adscan.py"), "utf8");

/** A constant from adscan.py: a string, or a number written as digits, `_` and `*`. */
function constant(name: string): string | number {
  const m = new RegExp(`^${name} = (.+?)(?:\\s+#.*)?$`, "m").exec(source);
  if (!m) throw new Error(`${name} is missing from adscan.py`);
  const value = m[1]!.trim();
  if (/^"[^"]*"$/.test(value)) return value.slice(1, -1);
  if (!/^[\d_\s*]+$/.test(value)) throw new Error(`${name} isn't a plain number: ${value}`);
  return value.split("*").reduce((product, n) => product * Number(n.replace(/_/g, "").trim()), 1);
}

/** The route file that answers a path, so a moved or renamed endpoint fails here. */
const route = (apiPath: string) => path.resolve(__dirname, "../app", `.${apiPath.replace(/\/$/, "/[fileId]")}`, "route.ts");

it("calls endpoints Murmur has", () => {
  for (const name of ["API_STATUS", "API_NEXT", "API_SCAN"]) {
    expect(fs.existsSync(route(constant(name) as string)), name).toBe(true);
  }
});

it("keeps Murmur's limits", () => {
  expect(constant("SECRET_MIN_LENGTH")).toBe(ADDON_SECRET_MIN_LENGTH);
  expect(constant("MAX_AD_SEC")).toBe(ADSCAN_LIMITS.maxAdSec);
  expect(constant("MAX_ADS")).toBe(ADSCAN_LIMITS.maxAds);
  expect(constant("MAX_RETRY_AFTER_SEC")).toBe(ADSCAN_LIMITS.maxRetryAfterSec);
  expect(constant("MAX_TEXT")).toBe(ADSCAN_LIMITS.maxText);
});
