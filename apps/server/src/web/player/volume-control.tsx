"use client";

import { VolumeIcon } from "../icons";
import { effectiveVolume, useVolume, volumeStore } from "./volume";

/**
 * The audio player's volume: a row under the controls with the mute button, a slider and a loud
 * speaker at the far end. Hidden on phones, which use their own buttons (see .vol-row).
 */
export function VolumeRow() {
  return (
    <div className="vol-row">
      <MuteButton size={18} quiet />
      <VolumeSlider className="scrubber" />
      <VolumeIcon level={1} size={18} aria-hidden="true" />
    </div>
  );
}

/** The player bar's: the mute button and a slider beside it, which a narrow window drops (see .pbar-vol). */
export function VolumeBar() {
  return (
    <div className="pbar-vol">
      <MuteButton size={20} />
      <VolumeSlider className="scrubber pbar-vol-slider" />
    </div>
  );
}

function VolumeSlider({ className }: { className: string }) {
  const volume = useVolume();
  const level = effectiveVolume(volume);
  return (
    <input
      type="range"
      className={className}
      aria-label="Volume"
      min={0}
      max={1}
      step={0.01}
      value={level}
      style={{ "--pct": `${level * 100}%` } as React.CSSProperties}
      onChange={(e) => volumeStore.set({ level: Number(e.target.value), muted: false })}
    />
  );
}

/** `quiet`: always the soft speaker (or muted), for the low end of the volume row. */
function MuteButton({ size, quiet = false }: { size?: number; quiet?: boolean }) {
  const volume = useVolume();
  const level = effectiveVolume(volume);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={volume.muted ? "Unmute" : "Mute"}
      // Unmuting from zero would stay silent, so it comes back at half.
      onClick={() => volumeStore.set(volume.muted || volume.level === 0 ? { level: volume.level || 0.5, muted: false } : { ...volume, muted: true })}
    >
      <VolumeIcon level={quiet && level > 0 ? 0.25 : level} size={size} />
    </button>
  );
}

/**
 * The video player's: a speaker button that slides a short volume slider out beside it on hover. It's this device's
 * volume, shared by the audio and video players; phones set volume with their own buttons, so
 * they don't get one (see .vol in watch/watch.css).
 */
export function VolumeControl({ size }: { size?: number }) {
  return (
    <div className="vol">
      <VolumeSlider className="scrubber vol-slider" />
      <MuteButton size={size} />
    </div>
  );
}
