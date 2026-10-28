"use client";

import { ShuffleIcon } from "../icons";
import { type MusicSource, usePlayer } from "../player/engine";

/**
 * The round Shuffle beside Play. Lit while shuffle is on. Off, it turns shuffle on and plays; on, or
 * while this music is already playing, it just toggles shuffle.
 */
export function ShuffleButton({ source, size }: { source: MusicSource; size?: number }) {
  const p = usePlayer();
  const from = p.isPlayingFrom(source.kind, source.refId);
  return (
    <button
      type="button"
      className="btn-round"
      aria-label="Shuffle"
      aria-pressed={p.shuffle}
      onClick={() => (from || p.shuffle ? p.toggleShuffle() : p.playMusic(source, -1, true))}
    >
      <ShuffleIcon size={size} />
    </button>
  );
}
