"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPaths, errorText, type PodcastDetail, type PodcastSummary } from "@murmur/shared/client";
import { api } from "../api";
import { CardMenu, MenuItem } from "../card-menu";
import { ConfirmSheet } from "../sheet";
import { toast } from "../toast";

type Choose = (fn: () => unknown) => () => void;

/**
 * A show's menu, the same on its card and its page: Check for new episodes, then the website and
 * Copy feed URL where they're known (the page), then Unsubscribe, which asks first.
 */
export function PodcastMenuItems({
  podcast,
  choose,
  unsubscribe,
  onChecked,
}: {
  podcast: PodcastSummary & Partial<Pick<PodcastDetail, "link" | "feedUrl">>;
  choose: Choose;
  unsubscribe: () => void;
  /** After a check, so the page can reload the episodes it holds. */
  onChecked?: () => void;
}) {
  const router = useRouter();
  return (
    <>
      <MenuItem
        onClick={choose(async () => {
          // The menu closes at once, so the toast says it's under way, then becomes the result.
          const id = `check-${podcast.id}`;
          toast("Checking for new episodes…", { id, duration: Infinity });
          try {
            await api(apiPaths.podcastRefresh(podcast.id), { method: "POST" });
          } catch (err) {
            toast.dismiss(id);
            throw err;
          }
          toast("Checked for new episodes", { id, duration: 4000 });
          router.refresh();
          onChecked?.();
        })}
      >
        Check for new episodes
      </MenuItem>
      {podcast.link ? <MenuItem onClick={choose(() => window.open(podcast.link!, "_blank", "noreferrer"))}>Podcast website</MenuItem> : null}
      {podcast.feedUrl ? (
        <MenuItem onClick={choose(() => navigator.clipboard?.writeText(podcast.feedUrl!).then(() => toast("Feed URL copied")))}>Copy feed URL</MenuItem>
      ) : null}
      <MenuItem danger onClick={choose(unsubscribe)}>
        Unsubscribe
      </MenuItem>
    </>
  );
}

/** Asks before unsubscribing; `after` runs once it's done (the show's page leaves). */
export function UnsubscribeSheet({ podcast, open, onClose, after }: { podcast: PodcastSummary; open: boolean; onClose: () => void; after?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmSheet
      open={open}
      title={`Unsubscribe from ${podcast.title}?`}
      message="Your listening history for this podcast is removed from your lists."
      confirmLabel="Unsubscribe"
      busy={busy}
      onConfirm={async () => {
        setBusy(true);
        try {
          await api(apiPaths.podcast(podcast.id), { method: "DELETE" });
          toast(`Unsubscribed from ${podcast.title}`);
          onClose();
          after?.();
          router.refresh();
        } catch (err) {
          toast.error(errorText(err, "Couldn't unsubscribe."));
          onClose();
        } finally {
          setBusy(false);
        }
      }}
      onClose={onClose}
    />
  );
}

/** A show card's ⋯ and right-click menu. */
export function PodcastCardMenu({ podcast }: { podcast: PodcastSummary }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <CardMenu label={podcast.title} items={(choose) => <PodcastMenuItems podcast={podcast} choose={choose} unsubscribe={() => setAsking(true)} />} />
      <UnsubscribeSheet podcast={podcast} open={asking} onClose={() => setAsking(false)} />
    </>
  );
}
