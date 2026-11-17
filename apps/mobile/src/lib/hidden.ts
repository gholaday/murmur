import { useQuery } from "@tanstack/react-query";
import { apiPaths, type HiddenChange, type HiddenDto } from "@murmur/shared/client";
import { toast } from "@/components/toast";
import { api } from "./api";
import { nullIfMissing } from "./data";
import { queryClient } from "./query";
import { keys } from "./query-keys";

/** You > Hidden: what you've hidden, by Library section. Null on a server from before hiding (1.4). */
export const useHidden = () => useQuery({ queryKey: keys.hidden, queryFn: () => api<HiddenDto>(apiPaths.hidden).catch(nullIfMissing) });

/**
 * Whether the server can hide things and keep likes, which came together: Hide, You > Hidden, the
 * Liked tab and chip go where it can't. Shown until it has said so.
 */
export const useCanHideAndLike = () => useHidden().data !== null;

/** The lists hiding changes: books, music (with artist and album pages), Watch and search. */
function refreshLists() {
  const { books, music, albums, album, artists, artist, search, watch } = keys.all;
  for (const queryKey of [books, music, albums, album, artists, artist, search, watch, keys.hidden]) void queryClient.invalidateQueries({ queryKey });
}

async function send(change: HiddenChange, hide: boolean) {
  await api(apiPaths.hidden, { method: hide ? "PUT" : "DELETE", body: change });
  refreshLists();
}

/** Hides one thing from your lists, with Undo on the toast; `onHidden` runs once it's done (a detail page goes back). */
export function hide(change: HiddenChange, title: string, onHidden?: () => void) {
  send(change, true).then(
    () => {
      onHidden?.();
      toast.show(`Hid ${title}`, { action: { label: "Undo", onPress: () => void unhide(change) }, duration: 5000 });
    },
    (err: unknown) => toast.error(err instanceof Error ? err.message : "Couldn't hide that."),
  );
}

/** Puts it back in your lists. */
export function unhide(change: HiddenChange) {
  // You > Hidden drops the row at once.
  queryClient.setQueryData<HiddenDto | null>(keys.hidden, (d) =>
    d && { books: d.books.filter((i) => !same(i, change)), music: d.music.filter((i) => !same(i, change)), watch: d.watch.filter((i) => !same(i, change)) },
  );
  return send(change, false).catch((err: unknown) => {
    toast.error(err instanceof Error ? err.message : "Couldn't unhide that.");
    void queryClient.invalidateQueries({ queryKey: keys.hidden });
  });
}

const same = (a: HiddenChange, b: HiddenChange) => a.kind === b.kind && a.id === b.id;
