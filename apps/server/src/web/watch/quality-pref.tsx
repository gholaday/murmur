"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { toast } from "sonner";
import { apiPaths, errorText, type VideoQuality } from "@murmur/shared/client";
import { api, refused } from "../api";

/**
 * Your video quality setting (You > Playback), the one place the web reads and saves it: the
 * layout seeds it from your settings, and Settings and the player's "too slow" note change it.
 */
const QualityPrefContext = createContext<{ quality: VideoQuality; save: (q: VideoQuality) => void }>({
  quality: "full",
  save: () => {},
});

export function QualityPrefProvider({ initial, children }: { initial: VideoQuality; children: React.ReactNode }) {
  const [quality, setQuality] = useState(initial);
  const value = useMemo(
    () => ({
      quality,
      save: (q: VideoQuality) => {
        const before = quality;
        setQuality(q);
        api(apiPaths.prefs, { method: "PUT", body: { videoQuality: q } }).catch((err: unknown) => {
          // Turned down, it says so; unreachable, the choice just goes back.
          setQuality(before);
          if (refused(err)) toast.error(errorText(err));
        });
      },
    }),
    [quality],
  );
  return <QualityPrefContext.Provider value={value}>{children}</QualityPrefContext.Provider>;
}

export const useQualityPref = () => useContext(QualityPrefContext);
