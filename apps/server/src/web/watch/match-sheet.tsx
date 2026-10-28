"use client";

/* eslint-disable @next/next/no-img-element -- TMDB poster thumbnails are remote */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorText, type WatchMatchResult } from "@murmur/shared/client";
import { api } from "../api";
import { CloseIcon } from "../icons";
import { useBackdropClose } from "../sheet";

/**
 * Match for a movie or show, built like an artist's Change photo: the title and year to search,
 * TMDB's results, and picking one applies it straight away.
 */
export function WatchMatchDialog({
  kind,
  id,
  title,
  year,
  tmdbId,
  onClose,
}: {
  kind: "movie" | "show";
  id: string;
  title: string;
  year: string | null;
  tmdbId: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const backdropClose = useBackdropClose(onClose);
  const [query, setQuery] = useState(title);
  const [yearText, setYearText] = useState(year ?? "");
  const [results, setResults] = useState<WatchMatchResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  const search = useCallback(
    async (q: string, y: string) => {
      setBusy(true);
      try {
        const params = new URLSearchParams({ kind, q });
        if (/^\d{4}$/.test(y)) params.set("year", y);
        setResults(await api<WatchMatchResult[]>(`/api/watch/match?${params}`));
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
    const el = ref.current;
    if (el && !el.open) el.showModal();
    void search(title, year ?? "");
  }, [search, title, year]);

  const pick = async (r: WatchMatchResult) => {
    setBusy(true);
    try {
      await api(`/api/watch/${kind === "movie" ? "movies" : "shows"}/${id}/match`, { method: "POST", body: { tmdbId: r.tmdbId } });
      toast(`Matched to ${r.title}`);
      router.refresh();
      onClose();
    } catch (err) {
      toast.error(errorText(err));
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="sheet wide" aria-label="Match" onClose={onClose} {...backdropClose}>
      <div className="edit">
        <div className="edit-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sheet-title" style={{ padding: 0 }}>
              Match
            </div>
            <div className="muted small edit-sub">{title}</div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="edit-body">
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
                    aria-pressed={r.tmdbId === tmdbId}
                    disabled={busy}
                    onClick={() => void pick(r)}
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
        </div>
      </div>
    </dialog>
  );
}
