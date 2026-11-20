"use client";

/* eslint-disable @next/next/no-img-element -- TMDB poster thumbnails are remote */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { apiPaths, errorText, type WatchMatchResult } from "@murmur/shared/client";
import { api } from "../api";

/**
 * Match for a movie or show, in its Edit, built like an artist's Change photo: the title and year
 * to search and TMDB's results. Tapping one picks it, and Use this match applies it.
 */
export function WatchMatchPanel({
  kind,
  id,
  title,
  year,
  tmdbId,
  onMatched,
}: {
  kind: "movie" | "show";
  id: string;
  title: string;
  year: string | null;
  tmdbId: number | null;
  onMatched: (title: string) => void;
}) {
  const [query, setQuery] = useState(title);
  const [yearText, setYearText] = useState(year ?? "");
  const [results, setResults] = useState<WatchMatchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Tapping a result only picks it; Use this match applies it. The current match has nothing to apply.
  const [picked, setPicked] = useState<WatchMatchResult | null>(null);
  const pickable = picked && picked.tmdbId !== tmdbId ? picked : null;

  const search = useCallback(
    async (q: string, y: string) => {
      setBusy(true);
      // A pick belongs to the results it was made in; a new search may not list it.
      setPicked(null);
      try {
        setResults(await api<WatchMatchResult[]>(apiPaths.watchMatchSearch({ kind, q, year: /^\d{4}$/.test(y) ? y : undefined })));
      } catch (err) {
        toast.error(errorText(err));
        setResults([]);
      } finally {
        setBusy(false);
      }
    },
    [kind],
  );

  useEffect(() => {
    void search(title, year ?? "");
  }, [search, title, year]);

  const apply = async (r: WatchMatchResult) => {
    setBusy(true);
    try {
      await api(`${apiPaths.watchItem(kind, id)}/match`, { method: "POST", body: { tmdbId: r.tmdbId } });
      onMatched(r.title);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="match-panel">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void search(query.trim(), yearText.trim());
        }}
      >
        <div className="form-row">
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title" aria-label="Search title" />
          <input
            className="input match-year"
            value={yearText}
            onChange={(e) => setYearText(e.target.value)}
            placeholder="Year"
            aria-label="Year"
            inputMode="numeric"
            maxLength={4}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !query.trim()}>
            Search
          </button>
        </div>
      </form>
      {pickable ? (
        <div className="match-bar">
          <button type="button" className="btn btn-primary wide" disabled={busy} onClick={() => void apply(pickable)}>
            {busy ? "Matching…" : "Use this match"}
          </button>
        </div>
      ) : null}
      {results === null ? (
        <div className="loading-center" aria-busy="true" aria-label="Searching">
          <div className="spinner" />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {results.map((r) => (
            <button
              key={r.tmdbId}
              type="button"
              className="candidate"
              aria-pressed={picked ? picked.tmdbId === r.tmdbId : r.tmdbId === tmdbId}
              disabled={busy}
              onClick={() => setPicked(picked?.tmdbId === r.tmdbId ? null : r)}
            >
              {r.posterUrl ? <img src={r.posterUrl} alt="" loading="lazy" className="match-poster" /> : <div className="cover match-poster" />}
              <span className="candidate-main">
                <span style={{ fontWeight: 700 }}>{r.title}</span>
                <span className="candidate-tags">
                  {r.year ? <span>{r.year}</span> : null}
                  {r.tmdbId === tmdbId ? <span>Now</span> : null}
                </span>
                {r.overview ? <span className="small muted match-overview">{r.overview}</span> : null}
              </span>
            </button>
          ))}
          {results.length === 0 ? <p className="muted">No results.</p> : null}
        </div>
      )}
    </div>
  );
}
