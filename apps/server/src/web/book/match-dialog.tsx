"use client";

/* eslint-disable @next/next/no-img-element -- provider cover thumbnails are remote */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { type BookDetail, duration, type MatchCandidate, type MatchField, type MatchPreview, type MatchSearchResult, type MatchValues, plural, seriesLabel } from "@murmur/shared/client";
import { api } from "../api";
import { BackIcon } from "../icons";

const keyOf = (c: Pick<MatchCandidate, "provider" | "providerId">) => `${c.provider}:${c.providerId}`;
const PROVIDER_NAME = { audible: "Audible", google: "Google Books", itunes: "Apple Books" } as const;

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

/** The fields last applied from a match, checked again at the next review. Kept in this browser. */
const LAST_FIELDS_KEY = "murmur.matchFields";

function lastFields(): MatchField[] | null {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_FIELDS_KEY) ?? "null") as unknown;
    return Array.isArray(raw) ? raw.filter((f): f is MatchField => FIELDS.some((x) => x.field === f)) : null;
  } catch {
    return null;
  }
}

function saveLastFields(fields: MatchField[]) {
  try {
    localStorage.setItem(LAST_FIELDS_KEY, JSON.stringify(fields));
  } catch {
    // private mode: the next review starts from the recommended fields
  }
}

// Only stray spaces at the ends are ignored: a change of case or spelling is worth applying.
const norm = (s: string | null) => (s ?? "").trim();

/**
 * The book already has exactly the result's value. Covers and chapter lists can't be told
 * apart from here, so they're never "same".
 */
function isSame(preview: MatchPreview, field: MatchField): boolean {
  const { current: c, proposed: p } = preview;
  switch (field) {
    case "title":
    case "author":
    case "narrator":
    case "year":
    case "description":
      return !!p[field] && norm(c[field]) === norm(p[field]);
    case "series":
      return !!p.series && norm(c.series) === norm(p.series) && c.seriesPosition === p.seriesPosition;
    default:
      return false;
  }
}

/** Fields the result has a new value for and that can be applied. */
function canApply(preview: MatchPreview, field: MatchField): boolean {
  const entry = FIELDS.find((f) => f.field === field);
  const blocked = field === "chapters" && !!preview.chaptersNote;
  return !!entry?.show(preview.proposed) && !blocked && !isSame(preview, field);
}

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

  const search = useCallback(
    async (custom?: { title: string; author: string }) => {
      setBusy(true);
      setPreview(null);
      try {
        const qs = custom ? `?${new URLSearchParams({ title: custom.title, author: custom.author })}` : "";
        const r = await api<MatchSearchResult>(`/api/books/${book.id}/match${qs}`);
        setResult(r);
        setSelected(r.suggested);
        // A source that couldn't be searched; the others' results still show. The id keeps a
        // repeat search from stacking the same message.
        for (const e of r.errors) toast.error(e, { id: e });
        if (!custom) {
          setTitle(r.query.title);
          setAuthor(r.query.author ?? "");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Search failed.");
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
    try {
      const p = await api<MatchPreview>(
        `/api/books/${book.id}/match/preview?${new URLSearchParams({ provider: c.provider, providerId: c.providerId })}`,
      );
      setPreview(p);
      // The fields applied last time, or the recommended ones the first time.
      setChosen(new Set(lastFields() ?? p.recommended));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load that result.");
    } finally {
      setBusy(false);
    }
  };

  // A remembered field this result has no value for stays unchecked and isn't sent.
  const fields = preview ? [...chosen].filter((f) => canApply(preview, f)) : [];

  const apply = async () => {
    if (!preview || fields.length === 0) return;
    setBusy(true);
    try {
      await api(`/api/books/${book.id}/match`, {
        method: "POST",
        body: { provider: preview.provider, providerId: preview.providerId, fields },
      });
      saveLastFields([...chosen]);
      onApplied();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't apply the match.");
    } finally {
      setBusy(false);
    }
  };


  return (
    <div className="match-panel">
      {preview ? (
        <>
          <div className="match-bar">
            <button type="button" className="btn" onClick={() => setPreview(null)}>
              <BackIcon size={18} /> Results
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || fields.length === 0} onClick={() => void apply()}>
              {busy ? "Applying…" : fields.length ? `Apply ${fields.length} ${fields.length === 1 ? "field" : "fields"}` : "Pick a field"}
            </button>
          </div>
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
                  const disabled = !canApply(preview, field);
                  const same = isSame(preview, field);
                  return (
                    <tr key={field} className={same ? "same" : undefined}>
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
                        <div className="val">{same ? <span className="muted">Same</span> : (proposed ?? <span className="muted">—</span>)}</div>
                        {field === "cover" && preview.proposed.coverWidth ? <div className="muted small">{preview.proposed.coverWidth}px</div> : null}
                        {blocked ? <div className="small error">{preview.chaptersNote}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
            <button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>
              {busy && !result ? "Searching…" : "Search"}
            </button>
          </form>

          {result ? (
            result.candidates.length === 0 ? (
              <p className="muted">No results.</p>
            ) : (
              <>
                <div className="match-bar">
                  <span className="muted small">{plural(result.candidates.length, "result")}</span>
                  <button type="button" className="btn btn-primary" disabled={!selected || busy} onClick={() => void review()}>
                    {busy ? "Loading…" : selected ? "Review changes" : "Pick a result"}
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
