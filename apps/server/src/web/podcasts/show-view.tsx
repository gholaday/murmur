"use client";

import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { apiPaths, type BookmarkDto, type EpisodeDto, type EpisodeWithShow, errorText, matchesEpisode, plural, type PodcastDetail, shortDate } from "@murmur/shared/client";
import { api } from "../api";
import { BookmarkRows } from "../bookmark-rows";
import { usePodcastBookmarks } from "../bookmarks";
import { Cover } from "../cover";
import { BookmarkIcon, CheckIcon, FilterIcon, LockIcon, MoreIcon, SearchIcon } from "../icons";
import { usePlayerControls } from "../player/engine";
import { BackButton, EmptyState, SearchBox, SectionTitle } from "../ui";
import { ConfirmSheet, Sheet, SheetItem } from "../sheet";
import { EpisodeRow } from "./episode-row";

function byEpisode(bookmarks: BookmarkDto[]) {
  const groups = new Map<string, BookmarkDto[]>();
  for (const b of bookmarks) groups.set(b.itemId, [...(groups.get(b.itemId) ?? []), b]);
  return groups;
}

export function ShowView({
  podcast,
  bookmarks: firstBookmarks,
  pageSize,
  firstPage,
}: {
  podcast: PodcastDetail;
  bookmarks: BookmarkDto[];
  /** Episodes shown per page; `firstPage` holds the newest page. */
  pageSize: number;
  firstPage: EpisodeDto[];
}) {
  const router = useRouter();
  const [oldestFirst, setOldestFirst] = useState(false);
  const [limit, setLimit] = useState(pageSize);
  const [sheet, setSheet] = useState<null | "menu" | "unsubscribe" | "sort" | "bookmarks">(null);
  const player = usePlayerControls();
  const bookmarks = usePodcastBookmarks(podcast.id, firstBookmarks);
  // Grouped by episode, newest bookmark's episode first. Rows are in order within each.
  const bookmarkGroups = useMemo(
    () => [...byEpisode(bookmarks).values()].sort((a, b) => Math.max(...b.map((m) => m.createdAt)) - Math.max(...a.map((m) => m.createdAt))),
    [bookmarks],
  );
  const firstByEpisode = useMemo(() => byEpisode(firstBookmarks), [firstBookmarks]);
  const [busy, setBusy] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // Every episode, fetched the first time you need more than the first page.
  const [all, setAll] = useState<EpisodeDto[] | null>(null);
  const complete = all !== null || firstPage.length >= podcast.episodeCount;
  const episodes = all ?? firstPage;

  const loadAll = async () => {
    try {
      setAll(await api<EpisodeDto[]>(`/api/podcasts/${podcast.id}/episodes?short=1`));
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

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? ordered.filter((e) => matchesEpisode(e, q)) : ordered),
    [ordered, q],
  );

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
      <div className="hero" style={{ "--tint": podcast.coverColor ?? "#1b3532" } as React.CSSProperties}>
        <div className="hero-bar">
          <BackButton fallback="/podcasts" />
          <button type="button" className="icon-btn" aria-label="More options" onClick={() => setSheet("menu")}>
            <MoreIcon />
          </button>
        </div>
        <div className="show-hero">
          <Cover
            src={podcast.coverHash ? apiPaths.podcastCoverUrl(podcast.id, podcast.coverHash, 600) : null}
            color={podcast.coverColor}
            title={podcast.title}
            large
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingBottom: 4, minWidth: 0 }}>
            <h1 className="show-title">{podcast.title}</h1>
            {podcast.author ? <div className="show-by">{podcast.author}</div> : null}
            <div className="show-by muted" style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px" }}>
              <span>{plural(podcast.episodeCount, "episode")}</span>
              {podcast.latestPublishedAt ? <span>Latest {shortDate(podcast.latestPublishedAt)}</span> : null}
            </div>
            {/* Told by the feed itself (a key in its URL, or itunes:block); never sent for ad detection. */}
            {podcast.privateFeed ? (
              <div className="pills">
                <span className="pill" title="A personal feed, so it isn't sent for ad detection">
                  <LockIcon size={12} />
                  Private
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <div className="show-actions" style={{ "--tint": podcast.coverColor ?? "#1b3532" } as React.CSSProperties}>
          <button type="button" className="btn btn-primary" onClick={() => setSheet("unsubscribe")}>
            <CheckIcon size={16} />
            Subscribed
          </button>
          {bookmarks.length ? (
            <button type="button" className="btn btn-tint" onClick={() => setSheet("bookmarks")}>
              <BookmarkIcon size={16} />
              Bookmarks
              <span className="count-pill">{bookmarks.length}</span>
            </button>
          ) : null}
        </div>
      </div>

      {podcast.lastError ? (
        <p className="error small" role="alert">
          Last feed check failed: {podcast.lastError}
        </p>
      ) : null}

      {podcast.description ? (
        <>
          <p className={`description ${aboutOpen ? "" : "clamped"}`} style={{ WebkitLineClamp: aboutOpen ? undefined : 2 }}>
            {podcast.description}
          </p>
          {podcast.description.length > 140 ? (
            <button type="button" className="more-link" onClick={() => setAboutOpen((o) => !o)}>
              {aboutOpen ? "Less" : "More"}
            </button>
          ) : null}
        </>
      ) : null}

      <div className="episodes-head">
        <div className="section-head">
          <SectionTitle title="Episodes" count={podcast.episodeCount} noun="episode" />
          <div style={{ display: "flex", gap: 4 }}>
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
        </div>
        {searching ? (
          <SearchBox value={query} onChange={setQuery} placeholder="Search episodes" label="Search episodes" />
        ) : null}
      </div>

      {q && !complete ? (
        <EmptyState>Searching…</EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState>{q ? "No episodes match." : "No episodes."}</EmptyState>
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
            void run(() => api(`/api/podcasts/${podcast.id}/refresh`, { method: "POST" }), "Checked for new episodes");
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

      <Sheet open={sheet === "bookmarks"} onClose={() => setSheet(null)} title="Bookmarks" count={bookmarks.length}>
        {bookmarkGroups.map((group) => (
          <section key={group[0]!.itemId} className="bookmark-group">
            <h3 className="list-row-title">{group[0]!.title}</h3>
            <BookmarkRows
              bookmarks={group}
              onJump={(b) => {
                setSheet(null);
                void player.jumpTo({ itemType: "episode", itemId: b.itemId }, b.positionSec);
              }}
            />
          </section>
        ))}
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
            await api(`/api/podcasts/${podcast.id}`, { method: "DELETE" });
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
