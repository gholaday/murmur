"use client";

import { chapterAt, SLEEP_MINUTES } from "@murmur/shared/client";
import { Sheet, SheetItem } from "../sheet";
import { usePlayerControls, usePlayerSelect, usePosition } from "./engine";

/** Off, a few timers, or the end of the chapter (or of the book, episode or song). Picking one closes it. */
export function SleepSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const item = usePlayerSelect((p) => p.item);
  const sleep = usePlayerSelect((p) => p.sleep);
  const { setSleep } = usePlayerControls();
  // Only follows the playhead while it's open, for where the chapter ends.
  const position = usePosition(open);
  if (!item) return null;
  const multiChapter = item.chapters.length > 1;
  const chapter = item.chapters[chapterAt(item.chapters, position)];
  const choose = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Sleep timer">
      <SheetItem active={sleep.mode === "off"} onClick={choose(() => setSleep({ mode: "off" }))}>
        Off
      </SheetItem>
      {SLEEP_MINUTES.map((m) => (
        <SheetItem key={m} onClick={choose(() => setSleep({ mode: "timer", endsAt: Date.now() + m * 60_000 }))}>
          {m} minutes
        </SheetItem>
      ))}
      <SheetItem
        active={sleep.mode === "chapter"}
        disabled={!(multiChapter && chapter) && !item.durationSec}
        onClick={choose(() => setSleep({ mode: "chapter", endSec: multiChapter && chapter ? chapter.endSec : item.durationSec }))}
      >
        End of {multiChapter ? "chapter" : item.type === "track" ? "song" : item.type === "book" ? "book" : "episode"}
      </SheetItem>
    </Sheet>
  );
}
