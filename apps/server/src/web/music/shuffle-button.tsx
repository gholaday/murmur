"use client";

import { ShuffleIcon } from "../icons";
import { type MusicSource, usePlayerControls, usePlayerSelect } from "../player/engine";

/**
 * The round Shuffle beside Play. Lit while shuffle is on. Off, it turns shuffle on and plays; on, or
 * while this music is already playing, it just toggles shuffle.
 */
export function ShuffleButton({ source, size }: { source: MusicSource; size?: number }) {
  const p = usePlayerControls();
  const from = usePlayerSelect((s) => s.isPlayingFrom(source.kind, source.refId));
  const shuffle = usePlayerSelect((s) => s.shuffle);
  return (
    <button
      type="button"
      className="btn-round"
      aria-label="Shuffle"
      aria-pressed={shuffle}
      onClick={() => (from || shuffle ? p.toggleShuffle() : p.playMusic(source, -1, true))}
    >
      <ShuffleIcon size={size} />
    </button>
  );
}
