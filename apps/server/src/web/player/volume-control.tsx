"use client";

import { VolumeIcon } from "../icons";
import { effectiveVolume, useVolume, volumeStore } from "./volume";

/**
 * A speaker button that slides a short volume slider out beside it on hover. It's this device's
 * volume, shared by the audio and video players; phones set volume with their own buttons, so
 * they don't get one (see .vol in globals.css).
 */
export function VolumeControl({ size }: { size?: number }) {
  const volume = useVolume();
  const level = effectiveVolume(volume);
  return (
    <div className="vol">
      <input
        type="range"
        className="scrubber vol-slider"
        aria-label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={level}
        style={{ "--pct": `${level * 100}%` } as React.CSSProperties}
        onChange={(e) => volumeStore.set({ level: Number(e.target.value), muted: false })}
      />
      <button
        type="button"
        className="icon-btn"
        aria-label={volume.muted ? "Unmute" : "Mute"}
        // Unmuting from zero would stay silent, so it comes back at half.
        onClick={() => volumeStore.set(volume.muted || volume.level === 0 ? { level: volume.level || 0.5, muted: false } : { ...volume, muted: true })}
      >
        <VolumeIcon level={level} size={size} />
      </button>
    </div>
  );
}
