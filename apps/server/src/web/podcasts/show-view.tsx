"use client";

import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  addTo,
  apiPaths,
  type BookmarkDto,
  type EpisodeDto,
  type EpisodeWithShow,
  errorText,
  FALLBACK_TINT,
  matchesEpisode,
  plural,
  type PodcastDetail,
  shortDate,
  SHOW_TABS,
  type ShowTab,
  unplayedEpisodes,
} from "@murmur/shared/client";
import { api } from "../api";
import { BookmarkRows } from "../bookmark-rows";
import { MoreLikeList } from "./browse";
import { usePodcastBookmarks } from "../bookmarks";
import { Cover } from "../cover";
import { CheckIcon, FilterIcon, LockIcon, SearchIcon } from "../icons";
import { usePlayerControls } from "../player/engine";
import { Chip, Chips, Description, EmptyState, HeroBar, SearchBox } from "../ui";
import { ConfirmSheet, Sheet, SheetItem } from "../sheet";
import { EpisodeRow } from "./episode-row";

/** A quiet check on the cover's top right corner says you're subscribed; it asks before unsubscribing. */
function SubscribedCheck({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="cover-corner" aria-label="Subscribed. Unsubscribe" onClick={onClick}>
      <CheckIcon size={16} />
    </button>
  );
}

function byEpisode(bookmarks: BookmarkDto[]) {
  const groups = new Map<string, BookmarkDto[]>();
  for (const b of bookmarks) addTo(groups, b.itemId, b);
  return groups;
}

export function ShowView({
  podcast,
  bookmarks: firstBookmarks,
  pageSize,
  firstPage,
  initialTab,
}: {
  podcast: PodcastDetail;
  bookmarks: BookmarkDto[];
  initialTab: ShowTab;
  /** Episodes shown per page; `firstPage` holds the newest page. */
  pageSize: number;
  firstPage: EpisodeDto[];
}) {
  const router = useRouter();
  const [oldestFirst, setOldestFirst] = useState(false);
  const [limit, setLimit] = useState(pageSize);
  const [sheet, setSheet] = useState<null | "menu" | "unsubscribe" | "sort">(null);
  const [tabPicked, setTab] = useState<ShowTab>(initialTab);
  const player = usePlayerControls();
  const bookmarks = usePodcastBookmarks(podcast.id, firstBookmarks);
  // Grouped by episode, newest bookmark's episode first. Rows are in order within each.
  const bookmarkGroups = useMemo(
    () => [...byEpisode(bookmarks).values()].sort((a, b) => Math.max(...b.map((m) => m.createdAt)) - Math.max(...a.map((m) => m.createdAt))),
    [bookmarks],
  );
  const firstByEpisode = useMemo(() => byEpisode(firstBookmarks), [firstBookmarks]);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // Every episode, fetched the first time you need more than the first page.
  const [all, setAll] = useState<EpisodeDto[] | null>(null);
  const complete = all !== null || firstPage.length >= podcast.episodeCount;
  const episodes = all ?? firstPage;

  const loadAll = async () => {
    try {
      setAll(await api<EpisodeDto[]>(apiPaths.podcastEpisodes(podcast.id)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load the episodes.");
    }
  };
  const changed = () => {
    router.refresh();
    if (all) void loadAll();
  };

  const withShow: EpisodeWithShow[] = useMemo(
    () =>
      episodes.map((e) => ({
        ...e,
        podcastTitle: podcast.title,
        podcastCoverHash: podcast.coverHash,
        podcastCoverColor: podcast.coverColor,
        speed: podcast.speed,
      })),
    [episodes, podcast],
  );
  // Oldest first waits for the full list, so it never shows the first page backwards.
  const ordered = useMemo(
    () => (oldestFirst && complete ? [...withShow].reverse() : withShow),
    [withShow, oldestFirst, complete],
  );

  // Bookmarks is only offered while there are some; deleting the last one goes back to Episodes.
  const tab: ShowTab = tabPicked === "bookmarks" && !bookmarks.length ? "episodes" : tabPicked;
  const tabs = SHOW_TABS.filter((t) => t.id !== "bookmarks" || bookmarks.length);
  // Unplayed needs every episode, so it fetches them as it opens, like search.
  const pickTab = (next: ShowTab) => {
    if (next === "unplayed" && !complete) void loadAll();
    setTab(next);
  };

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const list = tab === "unplayed" ? unplayedEpisodes(ordered) : ordered;
    return q ? list.filter((e) => matchesEpisode(e, q)) : list;
  }, [ordered, q, tab]);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
      changed();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="hero" style={{ "--tint": podcast.coverColor ?? FALLBACK_TINT.show } as React.CSSProperties}>
        <HeroBar fallback="/podcasts" onMore={() => setSheet("menu")} />
        <div className="book-hero">
          <div className="cover-wrap">
            <Cover
              src={podcast.coverHash ? apiPaths.podcastCoverUrl(podcast.id, podcast.coverHash, 600) : null}
              color={podcast.coverColor}
              title={podcast.title}
              large
            />
            <SubscribedCheck onClick={() => setSheet("unsubscribe")} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <h1 className="book-title">{podcast.title}</h1>
            {podcast.author ? <div className="book-narrator">{podcast.author}</div> : null}
            <div className="book-meta">
              <span>{plural(podcast.episodeCount, "episode")}</span>
              {podcast.latestPublishedAt ? <span>Latest {shortDate(podcast.latestPublishedAt)}</span> : null}
              {/* Told by the feed itself (a key in its URL, or itunes:block); never sent for ad detection. */}
              {podcast.privateFeed ? (
                <span className="book-meta-icon" title="A personal feed, so it isn't sent for ad detection">
                  <LockIcon size={12} />
                  Private
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>


      {podcast.lastError ? (
        <p className="error small" role="alert">
          Last feed check failed: {podcast.lastError}
        </p>
      ) : null}

      {podcast.description ? <Description text={podcast.description} longerThan={140} lines={2} /> : null}

      <div className="episodes-head">
        <div className="show-tabs">
          <Chips kind="tabs" label="Episodes view">
            {tabs.map((t) => (
              <Chip key={t.id} selected={tab === t.id} onClick={() => pickTab(t.id)}>
                {t.label}
              </Chip>
            ))}
          </Chips>
          {tab === "bookmarks" || tab === "morelike" ? null : (
            <div className="show-tabs-actions">
              <button
                type="button"
                className="icon-btn"
                aria-label="Search episodes"
                aria-pressed={searching}
                onClick={() => {
                  // Searching covers every episode, so fetch them as the box opens.
                  if (!searching && !complete) void loadAll();
                  setSearching((s) => !s);
                  setQuery("");
                }}
              >
                <SearchIcon />
              </button>
              <button type="button" className="icon-btn" aria-label="Sort episodes" onClick={() => setSheet("sort")}>
                <FilterIcon />
              </button>
            </div>
          )}
        </div>
        {searching && tab !== "bookmarks" && tab !== "morelike" ? (
          <SearchBox value={query} onChange={setQuery} placeholder="Search episodes" label="Search episodes" />
        ) : null}
      </div>

      <div key={tab} className="view-fade">
      {tab === "morelike" ? (
        <MoreLikeList feedUrl={podcast.feedUrl} />
      ) : tab === "bookmarks" ? (
        <div className="pod-bookmarks">
          {bookmarkGroups.map((group) => (
            <section key={group[0]!.itemId} className="bookmark-group">
              <h3 className="list-row-title">{group[0]!.title}</h3>
              <BookmarkRows
                bookmarks={group}
                onJump={(b) => void player.jumpTo({ itemType: "episode", itemId: b.itemId }, b.positionSec)}
              />
            </section>
          ))}
        </div>
      ) : (q || tab === "unplayed") && !complete ? (
        q ? <EmptyState>Searching…</EmptyState> : null
      ) : visible.length === 0 ? (
        q ? (
          <EmptyState>No episodes match.</EmptyState>
        ) : tab === "unplayed" ? (
          <EmptyState title="No unplayed episodes">You're all caught up.</EmptyState>
        ) : (
          <EmptyState>No episodes.</EmptyState>
        )
      ) : (
        <div>
          {visible.slice(0, limit).map((e) => (
            <EpisodeRow key={e.id} episode={e} firstBookmarks={firstByEpisode.get(e.id)} onChanged={changed} />
          ))}
          {(complete ? visible.length : podcast.episodeCount) > limit ? (
            <div style={{ textAlign: "center", padding: 16 }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (!complete) void loadAll();
                  setLimit((l) => l + pageSize);
                }}
              >
                Show more ({(complete ? visible.length : podcast.episodeCount) - limit} left)
              </button>
            </div>
          ) : null}
        </div>
      )}
      </div>

      <Sheet open={sheet === "sort"} onClose={() => setSheet(null)} title="Sort episodes">
        {[false, true].map((oldest) => (
          <SheetItem
            key={String(oldest)}
            active={oldestFirst === oldest}
            onClick={() => {
              if (oldest && !complete) void loadAll();
              setOldestFirst(oldest);
              setSheet(null);
            }}
          >
            {oldest ? "Oldest first" : "Newest first"}
          </SheetItem>
        ))}
      </Sheet>

      <Sheet open={sheet === "menu"} onClose={() => setSheet(null)} title={podcast.title}>
        <SheetItem
          disabled={busy}
          onClick={() => {
            setSheet(null);
            void run(() => api(apiPaths.podcastRefresh(podcast.id), { method: "POST" }), "Checked for new episodes");
          }}
        >
          {busy ? "Checking…" : "Check for new episodes"}
        </SheetItem>
        {podcast.link ? (
          <a className="sheet-item" href={podcast.link} target="_blank" rel="noreferrer">
            Podcast website
          </a>
        ) : null}
        <SheetItem
          onClick={() => {
            void navigator.clipboard?.writeText(podcast.feedUrl).then(() => toast("Feed URL copied"));
            setSheet(null);
          }}
        >
          Copy feed URL
        </SheetItem>
        <SheetItem danger onClick={() => setSheet("unsubscribe")}>
          Unsubscribe
        </SheetItem>
      </Sheet>

      <ConfirmSheet
        open={sheet === "unsubscribe"}
        title={`Unsubscribe from ${podcast.title}?`}
        message="Your listening history for this podcast is removed from your lists."
        confirmLabel="Unsubscribe"
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api(apiPaths.podcast(podcast.id), { method: "DELETE" });
            toast(`Unsubscribed from ${podcast.title}`);
            router.push("/podcasts");
            router.refresh();
          } catch (err) {
            toast.error(errorText(err, "Couldn't unsubscribe."));
            setBusy(false);
            setSheet(null);
          }
        }}
        onClose={() => setSheet(null)}
      />
    </>
  );
}
