"use client";

import { useEffect, useState } from "react";
import {
  defaultAudioTrack,
  pickSubtitle,
  subtitleDetails,
  subtitleMemory,
  subtitleName,
  subtitleRows,
  type VideoFileInfo,
  type VideoSubtitleTrack,
  videoSubtitleKey,
} from "@murmur/shared/client";
import { ChevronIcon } from "../icons";
import { Sheet, SheetItem } from "../sheet";

/** The subtitle language picked for a movie or show, on this device. */
export function readSubtitle(key: string): string | null {
  try {
    return localStorage.getItem(videoSubtitleKey(key));
  } catch {
    return null;
  }
}

export function saveSubtitle(key: string, track: VideoSubtitleTrack | null) {
  try {
    localStorage.setItem(videoSubtitleKey(key), subtitleMemory(track));
  } catch {
    // Not remembered in a private window.
  }
}

export function SubtitleSheet({
  open,
  tracks,
  value,
  onClose,
  onPick,
}: {
  open: boolean;
  tracks: VideoSubtitleTrack[];
  value: VideoSubtitleTrack | null;
  onClose: () => void;
  onPick: (track: VideoSubtitleTrack | null) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Subtitles">
      <SheetItem active={!value} onClick={() => onPick(null)}>
        <span style={{ flex: 1 }}>Off</span>
      </SheetItem>
      {subtitleRows(tracks).map((t) => (
        <SheetItem key={t.id} active={t.id === value?.id} onClick={() => onPick(t)}>
          <span style={{ flex: 1 }}>{subtitleName(t)}</span>
          <span className="muted small">{subtitleDetails(t)}</span>
        </SheetItem>
      ))}
    </Sheet>
  );
}

/** The Subtitles row on a movie or show page, for picking before playing. The player opens with the same choice. */
export function SubtitleRow({ file, memoryKey }: { file: VideoFileInfo; memoryKey: string }) {
  const tracks = file.subtitleTracks;
  const [picked, setPicked] = useState<VideoSubtitleTrack | null>(null);
  const [open, setOpen] = useState(false);
  // Storage only exists in the browser, so this follows the first render.
  useEffect(() => {
    const audio = file.audioTracks.find((t) => t.index === defaultAudioTrack(file));
    const track = pickSubtitle(file.subtitleTracks, readSubtitle(memoryKey), audio?.language ?? null);
    // A forced track shows by itself, so as a choice this is still Off.
    setPicked(track?.forced ? null : track);
  }, [file, memoryKey]);
  return (
    <>
      <button type="button" className="setting setting-link" onClick={() => setOpen(true)}>
        <span className="setting-title">Subtitles</span>
        <span className="setting-value">
          <span>{picked ? subtitleName(picked) : "Off"}</span>
          <ChevronIcon />
        </span>
      </button>
      <SubtitleSheet
        open={open}
        tracks={tracks}
        value={picked}
        onClose={() => setOpen(false)}
        onPick={(t) => {
          setOpen(false);
          setPicked(t);
          saveSubtitle(memoryKey, t);
        }}
      />
    </>
  );
}
