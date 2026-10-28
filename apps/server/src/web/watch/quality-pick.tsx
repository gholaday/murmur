"use client";

import { useEffect, useState } from "react";
import { apiPaths, playbackPlan, type UserPrefs, type VideoFileInfo, type VideoQuality } from "@murmur/shared/client";
import { api } from "../api";
import { Sheet, SheetItem } from "../sheet";
import { browserSupport } from "./support";

// The quality a converted picture is made at, picked per viewing like Plex: a button before Play
// on the movie and show pages, and Quality in the player's More sheet. Your setting under You >
// Playback is the starting point; a pick here is for this video only.

export const QUALITY_LABEL: Record<VideoQuality, string> = { full: "1080p", light: "720p" };
const QUALITY_SUB: Record<VideoQuality, string> = { full: "Full", light: "Lighter, easier on the server" };

/** The sheet with the two qualities. */
export function QualitySheet({ open, value, onClose, onPick }: { open: boolean; value: VideoQuality; onClose: () => void; onPick: (q: VideoQuality) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Quality">
      {(["full", "light"] as const).map((q) => (
        <SheetItem key={q} active={q === value} onClick={() => onPick(q)}>
          <span className="sheet-item-text">
            <span>{QUALITY_LABEL[q]}</span>
            <span className="sheet-item-sub">{QUALITY_SUB[q]}</span>
          </span>
        </SheetItem>
      ))}
    </Sheet>
  );
}

/** Your setting, read once per page. */
export function useDefaultQuality(): VideoQuality {
  const [quality, setQuality] = useState<VideoQuality>("full");
  useEffect(() => {
    api<UserPrefs>(apiPaths.prefs).then((p) => setQuality(p.videoQuality), () => undefined);
  }, []);
  return quality;
}

/** Whether this browser would have the server convert the file's picture; false until it's checked (it needs the browser). */
export function useConverts(file: VideoFileInfo | null): boolean {
  const [converts, setConverts] = useState(false);
  useEffect(() => {
    setConverts(!!file && playbackPlan(file, browserSupport(file)).kind === "transcode");
  }, [file]);
  return converts;
}

/**
 * The quality button beside Play, shown only when the picture will be converted, since otherwise
 * it changes nothing. `value` null means your setting.
 */
export function QualityPick({ file, value, onChange }: { file: VideoFileInfo | null; value: VideoQuality | null; onChange: (q: VideoQuality) => void }) {
  const [open, setOpen] = useState(false);
  const fallback = useDefaultQuality();
  const converts = useConverts(file);
  if (!converts) return null;
  const current = value ?? fallback;
  return (
    <>
      <button type="button" className="btn btn-big" aria-label={`Quality ${QUALITY_LABEL[current]}`} onClick={() => setOpen(true)}>
        {QUALITY_LABEL[current]}
      </button>
      <QualitySheet
        open={open}
        value={current}
        onClose={() => setOpen(false)}
        onPick={(q) => {
          onChange(q);
          setOpen(false);
        }}
      />
    </>
  );
}
