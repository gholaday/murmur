import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { AndroidHaptics } from "expo-haptics";
import { storageKeys } from "@murmur/shared/client";
import { isIOS } from "./platform";
import { createSavedStore } from "./store";

// Light taps on the controls people press most. Android uses the system's own feedback
// constants, which feel like its keyboard and follow the phone's Touch feedback setting,
// rather than driving the vibration motor directly.

export const hapticsStore = createSavedStore(storageKeys.haptics, true);

export const useHapticsEnabled = hapticsStore.useValue;

const sdk = Platform.OS === "android" ? (Platform.Version as number) : 0;
const R = 30;
const UPSIDE_DOWN_CAKE = 34;

// Each type throws below the Android version that added it, so older phones get an older one.
function android(type: AndroidHaptics | null) {
  if (hapticsStore.get() && type) Haptics.performAndroidHapticsAsync(type).catch(() => {});
}

function ios(run: () => Promise<void>) {
  if (hapticsStore.get()) run().catch(() => {});
}

/** A button that changes playback: play, pause, skip. */
export function tapHaptic() {
  if (isIOS) ios(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
  else android(AndroidHaptics.Virtual_Key);
}

/** Picking one of a set: a chip, a sort, a mode. */
export function selectHaptic() {
  if (isIOS) ios(Haptics.selectionAsync);
  else android(sdk >= UPSIDE_DOWN_CAKE ? AndroidHaptics.Segment_Tick : AndroidHaptics.Clock_Tick);
}

/** A long press that opens a row's or card's menu. */
function longPressHaptic() {
  if (isIOS) ios(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  else android(AndroidHaptics.Long_Press);
}

/** An onLongPress handler that gives the long-press haptic first; none when there's no `fn`. */
export const withLongPressHaptic = (fn: (() => void) | undefined) =>
  fn &&
  (() => {
    longPressHaptic();
    fn();
  });

/** A row lifted to drag. */
export function dragStartHaptic() {
  if (isIOS) ios(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  else android(sdk >= UPSIDE_DOWN_CAKE ? AndroidHaptics.Drag_Start : AndroidHaptics.Long_Press);
}

/** A dragged row dropped into place. */
export function dragEndHaptic() {
  if (isIOS) ios(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  else android(sdk >= R ? AndroidHaptics.Gesture_End : null);
}
