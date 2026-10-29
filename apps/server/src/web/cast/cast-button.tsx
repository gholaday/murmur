"use client";

import { CastIcon } from "../icons";
import { pickCastDevice, useCast } from "./cast";

/** The cast button in a player's top row. Only there when a Chromecast is found; accent while casting. */
export function CastButton() {
  const { available, device } = useCast();
  if (!available) return null;
  return (
    <button
      type="button"
      className={`icon-btn${device ? " cast-on" : ""}`}
      onClick={pickCastDevice}
      aria-label={device ? `Casting to ${device}` : "Cast"}
    >
      <CastIcon size={22} connected={!!device} />
    </button>
  );
}
