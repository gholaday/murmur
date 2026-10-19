"use client";

/* eslint-disable @next/next/no-img-element -- provider cover thumbnails are remote */
import { useCallback, useEffect, useState } from "react";
import { type BookDetail, duration, type MatchCandidate, type MatchField, type MatchPreview, type MatchSearchResult, type MatchValues, seriesLabel } from "@murmur/shared/client";
import { api } from "../api";
import { BackIcon } from "../icons";

const keyOf = (c: Pick<MatchCandidate, "provider" | "providerId">) => `${c.provider}:${c.providerId}`;
const PROVIDER_NAME = { audible: "Audible", google: "Google Books" } as const;

const FIELDS: Array<{ field: MatchField; label: string; show: (v: MatchValues) => React.ReactNode }> = [
  { field: "cover", label: "Cover", show: (v) => (v.coverUrl ? <img src={v.coverUrl} alt="" /> : <span className="muted">None</span>) },
  { field: "title", label: "Title", show: (v) => v.title },
  { field: "author", label: "Author", show: (v) => v.author },
  { field: "narrator", label: "Narrator", show: (v) => v.narrator },
  { field: "series", label: "Series", show: (v) => seriesLabel(v.series, v.seriesPosition) },
  { field: "year", label: "Year", show: (v) => v.year },
  { field: "description", label: "Description", show: (v) => v.description },
  { field: "chapters", label: "Chapters", show: (v) => (v.chapterCount ? `${v.chapterCount} chapters` : null) },
];

function scoreClass(score: number) {
  return score >= 90 ? "high" : score >= 70 ? "mid" : "";
}

/** Search, pick a result, review and apply. Starts searching as soon as it's shown. */
export function MatchPanel({ book, onApplied }: { book: BookDetail; onApplied: () => void }) {
  const [result, setResult] = useState<MatchSearchResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<MatchPreview | null>(null);
  const [chosen, setChosen] = useState<Set<MatchField>>(new Set());
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(
    async (custom?: { title: string; author: string }) => {
      setBusy(true);
      setError(null);
      setPreview(null);
      try {
        const qs = custom ? `?${new URLSearchParams({ title: custom.title, author: custom.author })}` : "";
        const r = await api<MatchSearchResult>(`/api/books/${book.id}/match${qs}`);
        setResult(r);
        setSelected(r.suggested);
        if (!custom) {
          setTitle(r.query.title);
          setAuthor(r.query.author ?? "");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed.");
      } finally {
        setBusy(false);
      }
    },
    [book.id],
  );

  useEffect(() => {
    void search();
  }, [search]);

  const review = async () => {
    const c = result?.candidates.find((x) => keyOf(x) === selected);
    if (!c) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api<MatchPreview>(
        `/api/books/${book.id}/match/preview?${new URLSearchParams({ provider: c.provider, providerId: c.providerId })}`,
      );
      setPreview(p);
      setChosen(new Set(p.recommended));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load that result.");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview || chosen.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/books/${book.id}/match`, {
        method: "POST",
        body: { provider: preview.provider, providerId: preview.providerId, fields: [...chosen] },
      });
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't apply the match.");
    } finally {
      setBusy(false);
    }
  };


  return (
    <div className="match-panel">
      {preview ? (
        <>
          <button type="button" className="btn" style={{ alignSelf: "flex-start" }} onClick={() => setPreview(null)}>
            <BackIcon size={18} /> Results
          </button>
          <div style={{ overflowX: "auto" }}>
            <table className="compare">
              <thead>
                <tr>
                  <th />
                  <th>Field</th>
                  <th>Now</th>
                  <th>{PROVIDER_NAME[preview.provider]}</th>
                </tr>
              </thead>
              <tbody>
                {FIELDS.map(({ field, label, show }) => {
                  const proposed = show(preview.proposed);
                  const blocked = field === "chapters" && !!preview.chaptersNote;
                  const disabled = !proposed || blocked;
                  return (
                    <tr key={field}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Use ${label.toLowerCase()} from ${PROVIDER_NAME[preview.provider]}`}
                          checked={chosen.has(field) && !disabled}
                          disabled={disabled}
                          onChange={(e) => {
                            const next = new Set(chosen);
                            if (e.target.checked) next.add(field);
                            else next.delete(field);
                            setChosen(next);
                          }}
                        />
                      </td>
                      <td className="field">{label}</td>
                      <td>
                        <div className="val">{show(preview.current) ?? <span className="muted">—</span>}</div>
                        {field === "cover" && preview.current.coverWidth ? <div className="muted small">{preview.current.coverWidth}px</div> : null}
                      </td>
                      <td>
                        <div className="val">{proposed ?? <span className="muted">—</span>}</div>
                        {field === "cover" && preview.proposed.coverWidth ? <div className="muted small">{preview.proposed.coverWidth}px</div> : null}
                        {blocked ? <div className="small error">{preview.chaptersNote}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {error ? <p className="error small">{error}</p> : null}
          <button type="button" className="btn btn-primary btn-big" disabled={busy || chosen.size === 0} onClick={() => void apply()}>
            {busy ? "Applying…" : chosen.size ? `Apply ${chosen.size} ${chosen.size === 1 ? "field" : "fields"}` : "Pick at least one field"}
          </button>
        </>
      ) : (
        <>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void search({ title, author });
            }}
          >
            <div className="form-row" style={{ flexWrap: "wrap" }}>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Search title" />
              <input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author" aria-label="Search author" />
            </div>
            <button type="submit" className="btn" disabled={busy || !title.trim()}>
              {busy && !result ? "Searching…" : "Search"}
            </button>
          </form>

          {result?.errors.map((e) => (
            <p key={e} className="error small" style={{ margin: 0 }}>
              {e}
            </p>
          ))}
          {error ? <p className="error small" style={{ margin: 0 }}>{error}</p> : null}

          {result ? (
            result.candidates.length === 0 ? (
              <p className="muted">No results.</p>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "48dvh", overflowY: "auto" }}>
                  {result.candidates.map((c) => {
                    const k = keyOf(c);
                    const on = selected === k;
                    return (
                      <button key={k} type="button" className="candidate" aria-pressed={on} onClick={() => setSelected(on ? null : k)}>
                        {c.coverUrl ? <img src={c.coverUrl} alt="" loading="lazy" /> : <div className="cover" />}
                        <span className="candidate-main">
                          <span style={{ fontWeight: 700 }}>
                            {c.title}
                            {c.subtitle ? <span className="muted">: {c.subtitle}</span> : null}
                          </span>
                          <span className="small">{[c.author, c.narrator ? `read by ${c.narrator}` : null].filter(Boolean).join(", ")}</span>
                          <span className="candidate-tags">
                            {[
                              seriesLabel(c.series, c.seriesPosition),
                              c.durationSec ? duration(c.durationSec) : null,
                              c.year,
                              PROVIDER_NAME[c.provider],
                            ]
                              .filter(Boolean)
                              .map((tag) => (
                                <span key={tag}>{tag}</span>
                              ))}
                          </span>
                          {on ? (
                            <ul className="reasons">
                              {c.reasons.map((r) => (
                                <li key={r}>{r}</li>
                              ))}
                            </ul>
                          ) : null}
                        </span>
                        <span className={`score ${scoreClass(c.score)}`}>{c.score}</span>
                      </button>
                    );
                  })}
                </div>
                <button type="button" className="btn btn-primary btn-big" disabled={!selected || busy} onClick={() => void review()}>
                  {busy ? "Loading…" : "Review changes"}
                </button>
              </>
            )
          ) : busy ? (
            <div className="loading-center" aria-busy="true" aria-label="Searching">
              <div className="spinner" />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
