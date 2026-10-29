// Live updates: the server counts changes per kind of media, and says whether a scan or matching
// is running, in one short header on API answers and from GET /api/changes. Clients poll often
// only while something is running, and reload a kind's lists when its count moves.

export type ChangeKind = "books" | "music" | "watch";
export const CHANGE_KINDS: readonly ChangeKind[] = ["books", "music", "watch"];
export const CHANGES_HEADER = "x-murmur-changes";

export interface Changes extends Record<ChangeKind, number> {
  /** Changes when the server restarts, so every kind counts as changed. */
  boot: string;
  /** A scan or matching is running. */
  busy: boolean;
}

/** While something is running, and otherwise. */
const BUSY_MS = 3000;
const IDLE_MS = 10 * 60_000;

export const formatChanges = (c: Changes) => `${c.boot}.${c.books}.${c.music}.${c.watch}.${c.busy ? 1 : 0}`;

export function parseChanges(token: string | null | undefined): Changes | null {
  const [boot, books, music, watch, busy] = token?.split(".") ?? [];
  if (!boot || busy === undefined) return null;
  return { boot, books: Number(books), music: Number(music), watch: Number(watch), busy: busy === "1" };
}

/**
 * Polls every few seconds while the server is busy and every ten minutes otherwise. `seen` takes
 * the header from any other API answer, so a scan that starts on its own is noticed on the next
 * call the client makes anyway. Stop it while the page or app is in the background.
 */
export function createChangesPoller(opts: { fetchToken: () => Promise<string | null>; onChange: (kinds: ChangeKind[]) => void }) {
  let last: Changes | null = null;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    clearTimeout(timer);
    if (running) timer = setTimeout(check, last?.busy ? BUSY_MS : IDLE_MS);
  };

  function seen(token: string | null | undefined) {
    const next = parseChanges(token);
    if (!next) return;
    const prev = last;
    last = next;
    if (prev) {
      const kinds = CHANGE_KINDS.filter((k) => prev.boot !== next.boot || prev[k] !== next[k]);
      if (kinds.length) opts.onChange(kinds);
    }
    // Only busy starting or stopping changes the wait; otherwise the running timer stands.
    if (!prev || prev.busy !== next.busy) schedule();
  }

  async function check() {
    const token = await opts.fetchToken().catch(() => null);
    if (token) seen(token);
    schedule();
  }

  return {
    seen,
    /** Checks now; call it on start and when the page or app comes back to the front. */
    start: () => {
      running = true;
      void check();
    },
    stop: () => {
      running = false;
      clearTimeout(timer);
    },
  };
}
