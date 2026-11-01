import { videoVersionKey } from "@murmur/shared/client";

/** The version picked for a movie, on this device. */
export function readVersion(movieId: string): string | null {
  try {
    return localStorage.getItem(videoVersionKey(movieId));
  } catch {
    return null;
  }
}

export function saveVersion(movieId: string, versionId: string) {
  try {
    localStorage.setItem(videoVersionKey(movieId), versionId);
  } catch {
    // Not remembered in a private window.
  }
}
