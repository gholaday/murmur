"use client";

/* eslint-disable @next/next/no-img-element -- provider cover thumbnails are remote */
import { useRouter } from "next/navigation";
import { useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  apiPaths,
  type BulkMatchDto,
  type BulkMatchItem,
  duration,
  errorText,
  type MatchField,
  plural,
} from "@murmur/shared/client";
import { api } from "../api";
import { FIELDS, lastFields, PROVIDER_NAME, scoreClass } from "../book/match-dialog";
import { Cover } from "../cover";
import { DownIcon } from "../icons";
import { Sheet } from "../sheet";
import { Chip, Chips, EmptyState } from "../ui";
import { BookActionsContext } from "./book-card";

const PATH = "/api/library/match";
const POLL_MS = 1500;
/** Review results this sure start ticked; the rest you tick yourself. */
const PICK_AT = 80;
/** Fields a first bulk match takes when no single match has been applied in this browser yet. */
const DEFAULT_FIELDS: MatchField[] = ["cover", "author", "narrator", "series", "year", "chapters"];

type Filter = "review" | "applied" | "none";
const FILTER_LABEL: Record<Filter, string> = { review: "To review", applied: "Applied", none: "No match" };

/**
 * Bulk match, shown with the Not matched chip: a Match all button, the run's progress, and its
 * results to review. The run itself is on the server, so leaving the page doesn't stop it.
 */
export function BulkMatch({ unmatched, children }: { unmatched: number; children: React.ReactNode }) {
  const router = useRouter();
  const actions = useContext(BookActionsContext);
  const [job, setJob] = useState<BulkMatchDto | null>(null);
  const [starting, setStarting] = useState(false);
  const [fields, setFields] = useState<Set<MatchField>>(new Set(DEFAULT_FIELDS));
  const [filter, setFilter] = useState<Filter>("review");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set<string>());

  // New review results that are sure enough start ticked; ones you've seen keep your choice.
  const adopt = (next: BulkMatchDto | null) => {
    setJob(next);
    if (!next) return;
    const fresh = next.items.filter((i) => i.status === "review" && !seen.current.has(i.bookId));
    if (fresh.length === 0) return;
    for (const i of fresh) seen.current.add(i.bookId);
    setPicked((p) => {
      const out = new Set(p);
      for (const i of fresh) if ((i.candidate?.score ?? 0) >= PICK_AT) out.add(i.bookId);
      return out;
    });
  };

  useEffect(() => {
    void api<BulkMatchDto | null>(PATH).then(adopt, () => undefined);
  }, []);

  // Poll while it runs; when it finishes, refresh the library so matched books lose their badge.
  const running = !!job?.running;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void api<BulkMatchDto | null>(PATH).then((next) => {
        adopt(next);
        if (!next?.running) router.refresh();
      }, () => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, router]);

  const run = async (fn: () => Promise<BulkMatchDto | null>, done?: string) => {
    setBusy(true);
    try {
      adopt(await fn());
      if (done) toast(done);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      seen.current.clear();
      setPicked(new Set());
      setFilter("review");
      const next = await api<BulkMatchDto>(PATH, { method: "POST", body: { fields: [...fields] } });
      setStarting(false);
      return next;
    });

  // Until a run starts, the unmatched books themselves show below the button.
  if (!job) {
    if (unmatched === 0) return children;
    return (
      <>
        <div className="bulk-bar">
          <span className="muted small">{plural(unmatched, "book")} not matched</span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setFields(new Set(lastFields() ?? DEFAULT_FIELDS));
              setStarting(true);
            }}
          >
            Match all
          </button>
        </div>
        <Sheet open={starting} onClose={() => setStarting(false)} title={`Match ${plural(unmatched, "book")}`}>
          <p className="sheet-note">
            Each book is searched and its best result shown for you to check. Nothing changes until you apply.
          </p>
          <div className="sheet-group">
            <span className="sheet-group-title">Fields to take</span>
            <Chips wrap>
              {FIELDS.map(({ field, label }) => (
                <Chip
                  key={field}
                  selected={fields.has(field)}
                  onClick={() => {
                    const next = new Set(fields);
                    if (next.has(field)) next.delete(field);
                    else next.add(field);
                    setFields(next);
                  }}
                >
                  {label}
                </Chip>
              ))}
            </Chips>
            <span className="muted small">Fields you've edited by hand are never changed, and covers only when the new one is bigger.</span>
          </div>
          <button type="button" className="btn btn-primary btn-big" disabled={busy || fields.size === 0} onClick={() => void start()}>
            {busy ? "Starting…" : "Start matching"}
          </button>
        </Sheet>
        {children}
      </>
    );
  }

  const by = (s: Filter) => job.items.filter((i) => i.status === s);
  const shown = by(filter);
  const pickedReview = by("review").filter((i) => picked.has(i.bookId));
  const apply = (bookIds: string[]) =>
    void run(
      () => api(`${PATH}/apply`, { method: "POST", body: { bookIds } }),
      bookIds.length === 1 ? "Matched" : `${plural(bookIds.length, "book")} matched`,
    ).then(() => router.refresh());

  return (
    <div className="bulk">
      {job.running ? (
        <div className="card-box bulk-progress">
          <div className="bulk-progress-head">
            <strong>Matching {plural(job.total, "book")}</strong>
            <span className="muted small">
              {job.done} of {job.total}
            </span>
          </div>
          <div className="bar thick">
            <div style={{ width: `${job.total ? (job.done / job.total) * 100 : 0}%` }} />
          </div>
          <div className="bulk-progress-foot muted small">
            <span>{job.current ? `Now: ${job.current}` : "Starting…"}</span>
            <button type="button" className="link-btn" disabled={busy} onClick={() => void run(() => api(PATH, { method: "DELETE" }))}>
              Stop
            </button>
          </div>
        </div>
      ) : (
        // Discarding drops the results only; matches already applied stay.
        <div className="bulk-progress-head">
          <strong>Matched {plural(job.total, "book")}</strong>
          <button type="button" className="link-btn" disabled={busy} onClick={() => void run(() => api(PATH, { method: "DELETE" }), "Results discarded")}>
            Discard
          </button>
        </div>
      )}

      <div className="subtabs bulk-tabs" role="tablist">
        {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
          <button key={f} type="button" role="tab" className="subtab" aria-selected={filter === f} onClick={() => setFilter(f)}>
            {FILTER_LABEL[f]}
          </button>
        ))}
        {filter === "review" && by("review").length ? (
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={busy || pickedReview.length === 0}
            onClick={() => apply(pickedReview.map((i) => i.bookId))}
          >
            {pickedReview.length ? `Apply ${pickedReview.length}` : "Pick some"}
          </button>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <EmptyState>{job.running ? "Nothing here yet." : `No books under ${FILTER_LABEL[filter].toLowerCase()}.`}</EmptyState>
      ) : (
        <div>
          {shown.map((item) => (
            <BulkRow
              key={item.bookId}
              item={item}
              picked={picked.has(item.bookId)}
              busy={busy}
              onPick={(on) =>
                setPicked((p) => {
                  const out = new Set(p);
                  if (on) out.add(item.bookId);
                  else out.delete(item.bookId);
                  return out;
                })
              }
              onUndo={() =>
                void run(() => api(`${PATH}/undo`, { method: "POST", body: { bookId: item.bookId } }), "Put back").then(() =>
                  router.refresh(),
                )
              }
              onApply={() => apply([item.bookId])}
              onSearch={() => actions?.edit(item.bookId, "match")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BulkRow({
  item,
  picked,
  busy,
  onPick,
  onUndo,
  onApply,
  onSearch,
}: {
  item: BulkMatchItem;
  picked: boolean;
  busy: boolean;
  onPick: (on: boolean) => void;
  onUndo: () => void;
  onApply: () => void;
  onSearch: () => void;
}) {
  const [open, setOpen] = useState(false);
  const c = item.candidate;
  const mine = item.coverHash ? apiPaths.coverUrl(item.bookId, item.coverHash, 200) : null;
  const sub = c
    ? [PROVIDER_NAME[c.provider], c.narrator ? `read by ${c.narrator}` : null, c.durationSec ? duration(c.durationSec) : null]
        .filter(Boolean)
        .join(", ")
    : null;
  const main = (
    <>
      <span className="list-row-title">{c ? c.title : item.title}</span>
      {c && c.title !== item.title ? <span className="list-row-meta">Yours: {item.title}</span> : null}
      {sub ? <span className="list-row-sub">{sub}</span> : null}
      {item.status === "applied" ? (
        <span className="list-row-sub">
          {item.applied.length
            ? `Changed ${item.applied.map((f) => FIELDS.find((x) => x.field === f)?.label.toLowerCase()).join(", ")}`
            : "Matched, nothing needed changing"}
        </span>
      ) : null}
      {item.message ? <span className="list-row-sub error">{item.message}</span> : null}
    </>
  );
  return (
    <div className="bulk-item">
      <div className="bulk-row">
        {item.status === "review" ? (
          <input type="checkbox" checked={picked} aria-label={`Apply the match for ${item.title}`} onChange={(e) => onPick(e.target.checked)} />
        ) : null}
        <div className="bulk-covers">
          <Cover src={mine} color={item.coverColor} title={item.title} />
          {c ? (
            <>
              <span className="muted" aria-hidden="true">
                →
              </span>
              {c.coverUrl ? <img src={c.coverUrl} alt="" loading="lazy" /> : <div className="bulk-nocover" />}
            </>
          ) : null}
        </div>
        {/* A result can be opened to see what it changes; a book with no result has nothing to show. */}
        {c ? (
          <button type="button" className="list-row-main bulk-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {main}
            <DownIcon size={16} />
          </button>
        ) : (
          <div className="list-row-main">{main}</div>
        )}
        {c ? <span className={`score ${scoreClass(c.score)}`}>{c.score}</span> : null}
        {item.status === "applied" ? (
          <button type="button" className="btn btn-small" disabled={busy} onClick={onUndo}>
            Undo
          </button>
        ) : (
          <div className="bulk-row-actions">
            <button type="button" className="btn btn-small" onClick={onSearch}>
              {item.status === "none" ? "Search" : "Change"}
            </button>
            {item.status === "review" ? (
              <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={onApply}>
                Apply
              </button>
            ) : null}
          </div>
        )}
      </div>
      {open && c ? <BulkChanges item={item} /> : null}
    </div>
  );
}

/** Each field the result changes, from what the book has now to what it would get. */
function BulkChanges({ item }: { item: BulkMatchItem }) {
  if (item.changes.length === 0) return <div className="bulk-changes muted small">Nothing would change.</div>;
  return (
    <dl className="bulk-changes">
      {item.changes.map((x) => (
        <div key={x.field} className={x.edited ? "edited" : undefined}>
          <dt>{FIELDS.find((f) => f.field === x.field)?.label}</dt>
          <dd>
            {x.edited ? (
              <span className="muted">Kept, you edited it</span>
            ) : (
              <>
                <span className="bulk-from">{x.from ?? "None"}</span>
                <span className="muted" aria-label="to">
                  →
                </span>
                <span>{x.to}</span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
