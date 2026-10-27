"use client";

import { useMemo, useState } from "react";
import { type AlbumSummary, albumInMusic, albumMatches, isNewAlbum, type MusicSummaryDto, plural, sortAlbums } from "@murmur/shared/client";
import { CloseIcon, FilterIcon, SearchIcon } from "../icons";
import { Chip, Chips, CountPill, EmptyState, SearchBox } from "../ui";
import { MusicBackRow } from "./album-view";
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
    <EmptyState>
      {q
        ? `No album matches "${query.trim()}".`
        : filter === "new"
          ? "No new albums in the last two weeks."
          : filter === "unmatched"
            ? "Every album is matched."
            : "Every album is in your music."}
    </EmptyState>
  );

  return (
    <>
      <MusicBackRow />
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
        <SearchBox value={query} onChange={setQuery} placeholder="Album or artist" label="Search albums" />
      ) : null}

      <Chips kind="tabs" label="Show">
        {FILTERS.map((f) => (
          <Chip key={f.id} selected={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
            {f.id === "new" && summary.newAlbums > 0 ? <CountPill count={summary.newAlbums} /> : null}
          </Chip>
        ))}
        {isAdmin && (unmatched.length > 0 || filter === "unmatched") ? (
          <Chip selected={filter === "unmatched"} onClick={() => setFilter("unmatched")}>
            Not matched
          </Chip>
        ) : null}
      </Chips>

      <div style={{ marginTop: 16 }}>{filter === "unmatched" ? <AlbumMatchAll albums={unmatched}>{grid}</AlbumMatchAll> : grid}</div>

      <AlbumSortSheet open={sortOpen} onClose={() => setSortOpen(false)} sort={sort} onPick={setSort} />
    </>
  );
}
