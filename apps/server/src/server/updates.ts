import { env } from "./env";
import { createLogger, errorMessage } from "./log";

/**
 * Checks GitHub for the newest Murmur release, so Settings can tell admins an update is out.
 * Nothing is installed: updating is still pulling the new image. UPDATE_CHECK=false turns it off.
 */

const RELEASES_URL = "https://api.github.com/repos/gholaday/murmur/releases/latest";
const CHECK_MS = 6 * 60 * 60_000;

export interface UpdateInfo {
  /** The newest release, like "0.2.7". */
  latest: string;
  url: string;
}

const log = createLogger("updates");
let available: UpdateInfo | null = null;
let checked = false;
let started = false;

/** True when version a is newer than b. Both are "x.y.z", with or without a leading v. */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10));
  const [x, y] = [parse(a), parse(b)];
  if (x.length !== 3 || y.length !== 3 || [...x, ...y].some((n) => !Number.isFinite(n))) return false;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i]! > y[i]!;
  }
  return false;
}

async function check() {
  try {
    const res = await fetch(RELEASES_URL, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/vnd.github+json", "User-Agent": `Murmur/${env.version}` },
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const release = (await res.json()) as { tag_name?: string; html_url?: string };
    const latest = release.tag_name?.replace(/^v/, "");
    if (!latest || !release.html_url) throw new Error("GitHub's answer had no release");
    available = isNewer(latest, env.version) ? { latest, url: release.html_url } : null;
    checked = true;
    if (available) log.info("update available", { current: env.version, latest });
  } catch (err) {
    // Kept as it was: a failed check says nothing about whether an update is out.
    log.warn("update check failed", { error: errorMessage(err) });
  }
}

/** Starts the checks: now and every 6 hours. Development builds aren't a release to compare. */
export function startUpdateChecks() {
  if (started || !env.updateCheck || env.devBuild) return;
  started = true;
  void check();
  setInterval(() => void check(), CHECK_MS).unref();
}

/** What the checks found: checked is false until one succeeds, or when checks are off. */
export function updateStatus(): { checked: boolean; update: UpdateInfo | null } {
  return { checked, update: available };
}
