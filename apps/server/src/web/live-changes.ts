"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CHANGES_HEADER, createChangesPoller } from "@murmur/shared/client";

let poller: ReturnType<typeof createChangesPoller> | null = null;

/** Hands the change counts on any API answer to the poller (see packages/shared/src/changes.ts). */
export function noteChanges(res: Response) {
  poller?.seen(res.headers.get(CHANGES_HEADER));
}

/** New books, music, movies and shows appear as scans find them, and posters as matching lands. */
export function useLiveChanges() {
  const router = useRouter();
  useEffect(() => {
    const p = createChangesPoller({
      fetchToken: () => fetch("/api/changes").then((r) => r.headers.get(CHANGES_HEADER)),
      // The server components reload in place; nothing on the page resets.
      onChange: () => router.refresh(),
    });
    poller = p;
    const onVisibility = () => (document.hidden ? p.stop() : p.start());
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      p.stop();
      poller = null;
    };
  }, [router]);
}
