import type { ItemType } from "@murmur/shared/client";
import { api } from "./api";

/** Marks a book or episode finished, or resets it to the start. */
export function setFinished(itemType: ItemType, itemId: string, durationSec: number, finished: boolean) {
  return api("/api/progress", {
    method: "PUT",
    body: {
      items: [
        {
          itemType,
          itemId,
          positionSec: finished ? durationSec : 0,
          durationSec,
          finished,
          updatedAt: Date.now(),
        },
      ],
    },
  });
}
