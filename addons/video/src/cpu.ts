import fs from "node:fs";
import os from "node:os";

// How many CPUs ffmpeg may use. In a container with a `cpus` limit, ffmpeg still sizes its thread
// pools from the host's core count, so a 1080p encode on a 4-CPU quota of an 8-core box runs twice
// the threads it has cores for and loses time switching between them. The quota is read from the
// cgroup once, and every ffmpeg run gets it as its thread count.

let cached: number | null = null;

/** The cgroup's CPU quota (v2, then v1), rounded up; null with no limit or outside a cgroup. */
function cgroupCpus(): number | null {
  try {
    // cgroup v2: "max 100000" or "200000 100000" (quota and period in microseconds).
    const [quota, period] = fs.readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim().split(/\s+/);
    if (quota && quota !== "max" && Number(period) > 0) return Math.ceil(Number(quota) / Number(period));
  } catch {
    // not v2
  }
  try {
    const quota = Number(fs.readFileSync("/sys/fs/cgroup/cpu/cpu.cfs_quota_us", "utf8"));
    const period = Number(fs.readFileSync("/sys/fs/cgroup/cpu/cpu.cfs_period_us", "utf8"));
    if (quota > 0 && period > 0) return Math.ceil(quota / period);
  } catch {
    // not v1 either
  }
  return null;
}

/** CPUs ffmpeg may use: the container's quota where there is one, else the machine's cores. At least 1. */
export function cpuCount(): number {
  cached ??= Math.max(1, Math.min(cgroupCpus() ?? Infinity, os.availableParallelism()));
  return cached;
}

/**
 * ffmpeg options that keep its decoder, filter and encoder threads within `cpuCount()`. Before `-i`
 * they bound the decoder and the filter graph; after the codec they bound the encoder.
 */
export function threadArgs(): { before: string[]; after: string[] } {
  const n = String(cpuCount());
  return { before: ["-threads", n, "-filter_threads", n], after: ["-threads", n] };
}
