import type { ItemType } from "@murmur/shared/client";
import { api } from "./api";

/** Marks a book or episode finished, or resets it to the start; "video" is a movie or TV episode. */
export function setFinished(itemType: ItemType | "video", itemId: string, durationSec: number, finished: boolean) {
  return setManyFinished([{ itemType, itemId, durationSec }], finished);
}

/** The same for several at once, like a whole season. */
export function setManyFinished(items: Array<{ itemType: ItemType | "video"; itemId: string; durationSec: number }>, finished: boolean) {
  const updatedAt = Date.now();
  return api("/api/progress", {
    method: "PUT",
    body: {
      items: items.map((i) => ({ ...i, positionSec: finished ? i.durationSec : 0, finished, updatedAt })),
    },
  });
}
