"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  apiPaths,
  type EpisodeWithShow,
  FALLBACK_TINT,
  NEW_EPISODES_PAGE,
  newByShow,
  PODCAST_LIST_TITLES,
  PODCAST_SECTION_SIZE,
  PODCAST_SORT_LABEL,
  PODCAST_TABS,
  type PodcastListId,
  type PodcastSort,
  type PodcastTab,
  type PodcastSummary,
  sortShows,
} from "@murmur/shared/client";
import { Cover } from "../cover";
import { Mixer } from "../mixer";
import { useNowPlaying } from "../player/engine";
import { FilterIcon, PlusIcon } from "../icons";
import { Chip, Chips, EmptyState, NestedHead, ScrollRow, SectionTitle, StickyHead } from "../ui";
import { ChoiceSheet } from "../sheet";
import { BrowseView } from "./browse";
import { PodcastCardMenu } from "./podcast-menu";
import { EpisodeActions, EpisodeRow, useEpisodePlay } from "./episode-row";

/** An episode you're part way through, as a wide card on Home's sideways shelf. */
function ContinueEpisodeCard({ episode: e, onChanged }: { episode: EpisodeWithShow; onChanged: () => void }) {
  const play = useEpisodePlay(e);
  return (
    <div
      className={`pod-continue${play.current ? " playing" : ""}`}
      style={{ "--tint": e.podcastCoverColor ?? FALLBACK_TINT.show } as React.CSSProperties}
    >
      <Link href={`/podcasts/${e.podcastId}`} className="pod-continue-link" title={e.title}>
        <Cover
          className="thumb"
          src={e.podcastCoverHash ? apiPaths.podcastCoverUrl(e.podcastId, e.podcastCoverHash, 200) : null}
          color={e.podcastCoverColor}
          title={e.podcastTitle}
        />
        <span className="pod-continue-text">
          <span className="episode-show">{e.podcastTitle}</span>
          <span className="pod-continue-title">{e.title}</span>
        </span>
      </Link>
      <EpisodeActions episode={e} play={play} onChanged={onChanged} />
    </div>
  );
}

export function PodcastCard({ podcast: p }: { podcast: PodcastSummary }) {
  const { current, playing } = useNowPlaying((n) => n.type === "episode" && n.podcastId === p.id);
  return (
    <div className={`card${current ? " playing" : ""}`}>
      <Link href={`/podcasts/${p.id}`} className="card-link" title={p.title}>
        <div className="card-cover">
          <Cover src={p.coverHash ? apiPaths.podcastCoverUrl(p.id, p.coverHash, 200) : null} color={p.coverColor} title={p.title} />
          {current ? <Mixer playing={playing} /> : null}
        </div>
        {p.unplayedCount > 0 ? <span className="badge-count">{p.unplayedCount > 99 ? "99+" : p.unplayedCount}</span> : null}
        <div className="card-title">{p.title}</div>
        {p.lastError ? <div className="card-sub error">Feed problem</div> : null}
      </Link>
      <PodcastCardMenu podcast={p} />
    </div>
  );
}

const tabFrom = (value: string | null): PodcastTab => (value === "shows" || value === "browse" ? value : "home");

export function PodcastsView({
  podcasts,
  continueEpisodes,
  newEpisodes,
}: {
  podcasts: PodcastSummary[];
  continueEpisodes: EpisodeWithShow[];
  newEpisodes: EpisodeWithShow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [sortOpen, setSortOpen] = useState(false);
  const [sort, setSort] = useState<PodcastSort>("latest");
  const [newShown, setNewShown] = useState(NEW_EPISODES_PAGE);
  // + switches to Browse with the box focused; picking the tab itself doesn't focus it.
  const [focusBox, setFocusBox] = useState(false);
  const refresh = () => router.refresh();
  const listParam = params.get("list");
  const list = listParam && listParam in PODCAST_LIST_TITLES ? (listParam as PodcastListId) : null;
  const tab = tabFrom(params.get("tab"));
  const switchTab = (next: PodcastTab) => {
    setFocusBox(false);
    window.history.replaceState(null, "", next === "home" ? pathname : `${pathname}?tab=${next}`);
  };
  const addPodcast = () => {
    switchTab("browse");
    setFocusBox(true);
  };

  const shows = useMemo(() => sortShows(podcasts, sort), [podcasts, sort]);
  const groups = useMemo(() => newByShow(newEpisodes), [newEpisodes]);

  // Every list is built from data already here, so skip the server round trip, like the Library shelves.
  const open = (id: PodcastListId) => {
    window.history.pushState(null, "", `${pathname}?list=${id}`);
    window.scrollTo(0, 0);
  };

  const sortSheet = (
    <ChoiceSheet
      open={sortOpen}
      onClose={() => setSortOpen(false)}
      title="Sort podcasts"
      choices={(Object.keys(PODCAST_SORT_LABEL) as PodcastSort[]).map((id) => ({ id, label: PODCAST_SORT_LABEL[id] }))}
      value={sort}
      onPick={setSort}
    />
  );

  // A section's full list, opened from its heading.
  if (list) {
    const count = list === "continue" ? continueEpisodes.length : newEpisodes.length;
    return (
      <>
        <NestedHead title={PODCAST_LIST_TITLES[list]} fallback="/podcasts" />
        {count === 0 ? (
          <EmptyState>Nothing here right now.</EmptyState>
        ) : list === "continue" ? (
          <div>
            {continueEpisodes.map((e) => (
              <EpisodeRow key={e.id} episode={e} showThumb onChanged={refresh} />
            ))}
          </div>
        ) : (
          <>
            <div>
              {newEpisodes.slice(0, newShown).map((e) => (
                <EpisodeRow key={e.id} episode={e} showThumb onChanged={refresh} />
              ))}
            </div>
            {newShown < newEpisodes.length ? (
              <div className="more-row">
                <button type="button" className="btn" onClick={() => setNewShown((n) => n + NEW_EPISODES_PAGE)}>
                  Show more
                </button>
              </div>
            ) : null}
          </>
        )}
      </>
    );
  }

  const browse = <BrowseView initialQuery={params.get("q") ?? ""} focus={focusBox} />;

  // With nothing followed yet, Browse is the whole page: it's where shows are found.
  if (podcasts.length === 0) {
    return (
      <>
        <StickyHead>
          <div className="page-head">
            <h1 className="page-title">Podcasts</h1>
          </div>
        </StickyHead>
        {browse}
      </>
    );
  }

  return (
    <>
      <StickyHead>
      <div className="page-head">
        <h1 className="page-title">Podcasts</h1>
        {tab !== "browse" ? (
          <div className="head-actions view-fade">
            {tab === "shows" && podcasts.length > 1 ? (
              <button type="button" className="icon-btn" aria-label="Sort podcasts" onClick={() => setSortOpen(true)}>
                <FilterIcon />
              </button>
            ) : null}
            <button type="button" className="icon-btn accent-icon" aria-label="Add podcast" onClick={addPodcast}>
              <PlusIcon />
            </button>
          </div>
        ) : null}
      </div>

      <Chips kind="tabs" label="Podcasts view">
        {PODCAST_TABS.map((t) => (
          <Chip key={t.id} selected={tab === t.id} onClick={() => switchTab(t.id)}>
            {t.label}
          </Chip>
        ))}
      </Chips>
      </StickyHead>

      <div key={tab} className="view-fade">
        {tab === "browse" ? (
          browse
        ) : tab === "shows" ? (
          <div className="grid" style={{ marginTop: 16 }}>
            {shows.map((p) => (
              <PodcastCard key={p.id} podcast={p} />
            ))}
          </div>
        ) : (
          <>
            {continueEpisodes.length ? (
              <section className="section">
                <div className="section-head">
                  <SectionTitle title={PODCAST_LIST_TITLES.continue} count={continueEpisodes.length} noun="episode" onOpen={() => open("continue")} />
                </div>
                <ScrollRow className="row-scroll pod-continue-row">
                  {continueEpisodes.map((e) => (
                    <ContinueEpisodeCard key={e.id} episode={e} onChanged={refresh} />
                  ))}
                </ScrollRow>
              </section>
            ) : null}

            {groups.length ? (
              <section className="section">
                <div className="section-head">
                  <SectionTitle title={PODCAST_LIST_TITLES.new} count={newEpisodes.length} noun="new episode" onOpen={() => open("new")} />
                </div>
                <div>
                  {groups.slice(0, PODCAST_SECTION_SIZE).map((g) => (
                    <EpisodeRow key={g.episode.id} episode={g.episode} showThumb newCount={g.count} onChanged={refresh} />
                  ))}
                </div>
              </section>
            ) : null}

            {!continueEpisodes.length && !groups.length ? (
              <EmptyState title="Nothing new">New episodes from your shows will show here.</EmptyState>
            ) : null}
          </>
        )}
      </div>

      {sortSheet}
    </>
  );
}
