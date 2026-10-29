import { HttpError } from "./http";

// A small in-memory limit on failed sign-ins: so many per name and per address in a window,
// then a 429 until it passes. One process, so a Map is enough; a restart simply forgets.

const WINDOW_MS = 15 * 60_000;
/** Per username: enough for a forgotten password, not for guessing one. */
const PER_NAME = 20;
/** Per client address, across all names. */
const PER_ADDRESS = 60;

const failures = new Map<string, number[]>();

function recent(key: string, now: number): number[] {
  const times = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length) failures.set(key, times);
  else failures.delete(key);
  return times;
}

/** Where a request came from, as the proxy reports it; "direct" when nothing says. */
export function clientAddress(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "direct";
}

/** Throws 429 when this name or address has failed too often lately. */
export function assertSignInAllowed(username: string, address: string) {
  const now = Date.now();
  const tooMany = recent(`name:${username.toLowerCase()}`, now).length >= PER_NAME || recent(`addr:${address}`, now).length >= PER_ADDRESS;
  if (tooMany) throw new HttpError(429, "Too many sign-in attempts. Try again in a few minutes.", { "Retry-After": String(WINDOW_MS / 1000) });
}

export function recordSignInFailure(username: string, address: string) {
  const now = Date.now();
  for (const key of [`name:${username.toLowerCase()}`, `addr:${address}`]) failures.set(key, [...recent(key, now), now]);
  // The map only ever holds recent keys; a sweep keeps it from growing with one-off names.
  if (failures.size > 10_000) for (const key of failures.keys()) recent(key, now);
}
