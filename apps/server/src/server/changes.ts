// Live updates without push: a counter per kind of media that goes up as scans and matching
// change it, and whether any of them is running. Clients read it from the CHANGES_HEADER on any
// API answer (added in src/proxy.ts) or from GET /api/changes, and reload a kind's lists when its
// counter moves. Kept on globalThis since Next bundles the proxy and each route separately.
import { CHANGES_HEADER, type ChangeKind, formatChanges } from "@murmur/shared";

export { CHANGES_HEADER };

declare global {
  var __murmurChanges: { boot: string; counts: Record<ChangeKind, number>; busy: () => boolean } | undefined;
}

const changes = (globalThis.__murmurChanges ??= {
  // A restart starts the counters over, so clients reload everything when this differs.
  boot: Date.now().toString(36),
  counts: { books: 0, music: 0, watch: 0 },
  busy: () => false,
});

/** Something clients show for this kind was added, changed or removed. */
export function bumpChanges(kind: ChangeKind) {
  changes.counts[kind]++;
}

/** Set once at start: whether a scan or matching is running right now. */
export function setBusy(busy: () => boolean) {
  changes.busy = busy;
}

export const changesToken = () => formatChanges({ boot: changes.boot, ...changes.counts, busy: changes.busy() });
