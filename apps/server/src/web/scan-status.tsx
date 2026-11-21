"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiPaths, errorText, type LibraryAdminDto, type ScanKind, scanShare, type ScanStatusDto } from "@murmur/shared/client";
import { api } from "./api";
import { toast } from "./toast";

const SCAN_POLL_MS = 1000;

/**
 * A kind's scan as it happens: while one runs (started here or anywhere else), it's asked for
 * every second so its count and bar move, and the page refreshes once it's done.
 */
export function useLiveScan(kind: ScanKind, initial: ScanStatusDto) {
  const router = useRouter();
  const [scan, setScan] = useState(initial);
  const [starting, setStarting] = useState(false);
  useEffect(() => setScan(initial), [initial]);

  const running = starting || scan.running;
  useEffect(() => {
    if (!running) return;
    let stopped = false;
    const timer = window.setInterval(() => {
      api<LibraryAdminDto>(apiPaths.libraryAdmin).then(
        (admin) => {
          if (stopped) return;
          const next = admin[kind].scan;
          setScan(next);
          setStarting(false);
          if (!next.running) router.refresh();
        },
        () => undefined,
      );
    }, SCAN_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [running, kind, router]);

  const rescan = async () => {
    setStarting(true);
    try {
      await api(apiPaths.scan[kind], { method: "POST" });
    } catch (err) {
      setStarting(false);
      toast.error(errorText(err));
    }
  };
  // Until the first answer after Rescan, it counts as running with nothing found yet.
  return { scan: starting && !scan.running ? { ...scan, running: true, progress: null } : scan, running, rescan };
}

/** A thin accent bar under a scan's row, filling as it goes; nothing until it knows how much there is. */
export function ScanBar({ scan }: { scan: ScanStatusDto }) {
  const share = scanShare(scan);
  if (share === null) return null;
  return (
    <span className="scan-bar" aria-hidden="true">
      <span style={{ width: `${Math.round(share * 100)}%` }} />
    </span>
  );
}
