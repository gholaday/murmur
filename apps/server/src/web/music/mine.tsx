"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiPaths, errorText, type MusicMineChange, type MusicSummaryDto } from "@murmur/shared/client";
import { api } from "../api";
import { CheckIcon, PlusIcon } from "../icons";

// Adding to and removing from your music. Every change refreshes the page's server data, so
// counts and lists catch up; the buttons show the new state straight away.

/** Adds (`add`) or removes the songs a change names; resolves false when it failed. */
export function useMineChange(): (add: boolean, change: MusicMineChange) => Promise<boolean> {
  const router = useRouter();
  return async (add, change) => {
    try {
      await api<MusicSummaryDto>(apiPaths.mine, { method: add ? "PUT" : "DELETE", body: change });
      router.refresh();
      return true;
    } catch (err) {
      toast.error(errorText(err, add ? "Couldn't add that." : "Couldn't remove that."));
      return false;
    }
  };
}

/** A toggle that flips at once and goes back if the server says no. */
function useToggle(added: boolean, change: MusicMineChange) {
  const send = useMineChange();
  const [shown, setShown] = useState(added);
  useEffect(() => setShown(added), [added]);
  const toggle = async () => {
    const next = !shown;
    setShown(next);
    if (!(await send(next, change))) setShown(!next);
  };
  return [shown, toggle] as const;
}

/** The round + / check over an album cover: adds or removes all its songs. */
export function AlbumBadge({ title, added, albumId }: { title: string; added: boolean; albumId: string }) {
  const [shown, toggle] = useToggle(added, { albumIds: [albumId] });
  return (
    <button
      type="button"
      className="add-badge"
      aria-pressed={shown}
      aria-label={shown ? `Remove ${title} from your music` : `Add ${title} to your music`}
      onClick={toggle}
    >
      {shown ? <CheckIcon size={18} /> : <PlusIcon size={18} />}
    </button>
  );
}

/** A + / check at the end of a song or album row. */
export function MineToggle({ title, added, change }: { title: string; added: boolean; change: MusicMineChange }) {
  const [shown, toggle] = useToggle(added, change);
  return (
    <button
      type="button"
      className="icon-btn song-toggle"
      aria-pressed={shown}
      aria-label={shown ? `Remove ${title} from your music` : `Add ${title} to your music`}
      onClick={toggle}
    >
      {shown ? <CheckIcon size={20} /> : <PlusIcon size={20} />}
    </button>
  );
}
