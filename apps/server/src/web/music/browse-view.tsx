"use client";

import { useMemo, useState } from "react";
import { type AlbumSummary, albumInMusic, albumMatches, isNewAlbum, type MusicSummaryDto, plural, sortAlbums } from "@murmur/shared/client";
import { CloseIcon, FilterIcon, SearchIcon } from "../icons";
import { BackRow } from "./album-view";
import { AlbumCard, AlbumSortSheet, useAlbumSort } from "./music-view";

type Filter = "all" | "not" | "new";
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "not", label: "Not added" },
  { id: "new", label: "New" },
];

/** Every album, each with a + to add it to your music (or a check once it's in). */
export function BrowseView({ summary, albums }: { summary: MusicSummaryDto; albums: AlbumSummary[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useAlbumSort();
  const [sortOpen, setSortOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const sorted = useMemo(() => sortAlbums(albums, sort), [albums, sort]);
  const shown = sorted.filter(
    (a) => albumMatches(a, q) && (filter === "all" || (filter === "new" ? isNewAlbum(a) : albumInMusic(a) !== "all")),
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
      </div>

      <div style={{ marginTop: 16 }}>
        {shown.length ? (
          <div className="grid">
            {shown.map((a) => (
              <AlbumCard key={a.id} album={a} badge />
            ))}
          </div>
        ) : (
          <div className="empty">
            {q ? `No album matches "${query.trim()}".` : filter === "new" ? "No new albums in the last two weeks." : "Every album is in your music."}
          </div>
        )}
      </div>

      <AlbumSortSheet open={sortOpen} onClose={() => setSortOpen(false)} sort={sort} onPick={setSort} />
    </>
  );
}
