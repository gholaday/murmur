"use client";

import { useMemo, useState } from "react";
import { type AlbumSummary, albumInMusic, albumMatches, isNewAlbum, type MusicSummaryDto, plural, sortAlbums } from "@murmur/shared/client";
import { CloseIcon, FilterIcon, SearchIcon } from "../icons";
import { BackRow } from "./album-view";
import { AlbumMatchAll } from "./match-all";
import { AlbumCard, AlbumSortSheet, useAlbumSort } from "./music-view";

type Filter = "all" | "not" | "new" | "unmatched";
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "not", label: "Not added" },
  { id: "new", label: "New" },
];

/** Every album, each with a + to add it to your music (or a check once it's in). */
export function BrowseView({ summary, albums, isAdmin }: { summary: MusicSummaryDto; albums: AlbumSummary[]; isAdmin: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useAlbumSort();
  const [sortOpen, setSortOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const sorted = useMemo(() => sortAlbums(albums, sort), [albums, sort]);
  const keep: Record<Filter, (a: AlbumSummary) => boolean> = {
    all: () => true,
    not: (a) => albumInMusic(a) !== "all",
    new: isNewAlbum,
    unmatched: (a) => !a.matched,
  };
  const shown = sorted.filter((a) => albumMatches(a, q) && keep[filter](a));
  const unmatched = albums.filter((a) => !a.matched);
  const grid = shown.length ? (
    <div className="grid">
      {shown.map((a) => (
        <AlbumCard key={a.id} album={a} badge />
      ))}
    </div>
  ) : (
    <div className="empty">
      {q
        ? `No album matches "${query.trim()}".`
        : filter === "new"
          ? "No new albums in the last two weeks."
          : filter === "unmatched"
            ? "Every album is matched."
            : "Every album is in your music."}
    </div>
  );

  return (
    <>
      <BackRow />
      <div className="page-head">
        <div>
          <h1 className="page-title">Browse</h1>
          <div className="page-sub">{`${plural(summary.albums, "album")}, ${summary.mine.albums} in your music`}</div>
        </div>
        <div className="head-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label={searching ? "Close search" : "Search"}
            onClick={() => {
              setSearching((s) => !s);
              setQuery("");
            }}
          >
            {searching ? <CloseIcon /> : <SearchIcon />}
          </button>
          <button type="button" className="icon-btn" aria-label="Sort" onClick={() => setSortOpen(true)}>
            <FilterIcon />
          </button>
        </div>
      </div>

      {searching ? (
        <div className="search">
          <SearchIcon />
          <input className="input" type="search" placeholder="Album or artist" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search albums" autoFocus />
        </div>
      ) : null}

      <div className="chips" role="tablist" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" className="chip" aria-selected={filter === f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
            {f.id === "new" && summary.newAlbums > 0 ? <span className="count-pill">{summary.newAlbums}</span> : null}
          </button>
        ))}
        {isAdmin && (unmatched.length > 0 || filter === "unmatched") ? (
          <button
            type="button"
            role="tab"
            className="chip"
            aria-selected={filter === "unmatched"}
            aria-pressed={filter === "unmatched"}
            onClick={() => setFilter("unmatched")}
          >
            Not matched
          </button>
        ) : null}
      </div>

      <div style={{ marginTop: 16 }}>{filter === "unmatched" ? <AlbumMatchAll albums={unmatched}>{grid}</AlbumMatchAll> : grid}</div>

      <AlbumSortSheet open={sortOpen} onClose={() => setSortOpen(false)} sort={sort} onPick={setSort} />
    </>
  );
}
