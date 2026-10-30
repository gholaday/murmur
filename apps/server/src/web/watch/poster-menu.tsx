"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { MovieDetail, ShowDetail } from "@murmur/shared/client";
import { useAdmin } from "../admin";
import { api } from "../api";
import { CardMenu, MenuItem, MenuSep } from "../card-menu";
import { setFinished, setManyFinished } from "../progress";
import { WatchEditDialog, type WatchEditTab } from "./edit-sheet";

const detailUrl = (kind: "movie" | "show", id: string) => `/api/watch/${kind === "movie" ? "movies" : "shows"}/${id}`;

type PlayHref = (kind: "movie" | "episode", id: string) => string;

/**
 * A movie's or show's menu, the same on its card and its page: Play or Resume and Mark as watched,
 * then for admins Edit and Match. `load` gives the details when an item needs them.
 */
export function WatchMenuItems({
  kind,
  id,
  watched,
  resume,
  playHref,
  load,
  edit,
  choose,
}: {
  kind: "movie" | "show";
  id: string;
  watched: boolean;
  /** A movie partway through. */
  resume: boolean;
  playHref: PlayHref;
  load: () => Promise<MovieDetail | ShowDetail>;
  edit: (tab: WatchEditTab) => unknown;
  choose: (fn: () => unknown) => () => void;
}) {
  const router = useRouter();
  const { isAdmin, tmdb } = useAdmin();
  return (
    <>
      <MenuItem
        onClick={choose(async () => {
          if (kind === "movie") return router.push(playHref("movie", id));
          const show = (await load()) as ShowDetail;
          if (show.upNextId) router.push(playHref("episode", show.upNextId));
        })}
      >
        {resume ? "Resume" : "Play"}
      </MenuItem>
      <MenuItem
        onClick={choose(async () => {
          const item = await load();
          if (kind === "movie") await setFinished("video", id, (item as MovieDetail).durationSec, !watched);
          else {
            const episodes = (item as ShowDetail).seasonList.flatMap((s) => s.episodes);
            await setManyFinished(
              episodes.map((e) => ({ itemType: "video" as const, itemId: e.id, durationSec: e.durationSec })),
              !watched,
            );
          }
          toast(watched ? "Marked as not watched" : "Marked as watched");
          router.refresh();
        })}
      >
        {watched ? "Mark as not watched" : "Mark as watched"}
      </MenuItem>
      {isAdmin ? (
        <>
          <MenuSep />
          <MenuItem onClick={choose(() => edit("details"))}>Edit…</MenuItem>
          {tmdb ? <MenuItem onClick={choose(() => edit("match"))}>Match…</MenuItem> : null}
        </>
      ) : null}
    </>
  );
}

/** A poster card's menu. The details are fetched only when an item needs them. */
export function PosterCardMenu({
  kind,
  id,
  title,
  watched,
  resume,
  playHref,
}: {
  kind: "movie" | "show";
  id: string;
  title: string;
  watched: boolean;
  resume: boolean;
  playHref: PlayHref;
}) {
  const { tmdb } = useAdmin();
  const [editing, setEditing] = useState<{ tab: WatchEditTab; item: MovieDetail | ShowDetail } | null>(null);
  const load = () => api<MovieDetail | ShowDetail>(detailUrl(kind, id));

  return (
    <>
      <CardMenu
        label={title}
        items={(choose) => (
          <WatchMenuItems
            kind={kind}
            id={id}
            watched={watched}
            resume={resume}
            playHref={playHref}
            load={load}
            edit={async (tab) => setEditing({ tab, item: await load() })}
            choose={choose}
          />
        )}
      />
      {editing ? <WatchEditDialog kind={kind} item={editing.item} tab={editing.tab} canMatch={tmdb} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
