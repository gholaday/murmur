import * as Haptics from "expo-haptics";
import { isIOS } from "./platform";

// Light taps for the moments iOS users expect to feel. Android's vibration motors vary too
// much to match, so it stays as it was.

/** A button that changes playback: play, pause, skip. */
export function tapHaptic() {
  if (isIOS) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/** Picking one of a set: a chip, a sort, a mode. */
export function selectHaptic() {
  if (isIOS) void Haptics.selectionAsync();
}

/** A row lifted to drag, or dropped into place. */
export function dragHaptic() {
  if (isIOS) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}
