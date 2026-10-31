"use client";

/* eslint-disable @next/next/no-img-element -- source cover thumbnails are remote */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ALBUM_PROVIDER_NAME,
  type AlbumMatchAllDto,
  type AlbumMatchAllItem,
  type AlbumMatchAllField,
  type AlbumSummary,
  albumCover,
  errorText,
  plural,
} from "@murmur/shared/client";
import { api } from "../api";
import { scoreClass } from "../book/match-dialog";
import { Cover } from "../cover";
import { DownIcon } from "../icons";
import { Sheet } from "../sheet";
import { Chip, Chips, EmptyState } from "../ui";
import { ALBUM_FIELDS, AlbumMatchDialog, lastAlbumFields } from "./match";

// Match all for albums, the same screen as books' bulk match: a Match all button over the
// unmatched albums, the run's progress, and its results to review.

const PATH = "/api/music/match";
const POLL_MS = 1500;
/** Review results this sure start ticked; the rest you tick yourself. */
const PICK_AT = 80;
/** Fields a first Match all takes when no album match has been applied in this browser yet. */
const DEFAULT_FIELDS: AlbumMatchAllField[] = ["cover", "year", "genre"];

/** Match all never takes songs; those are matched one album at a time. */
const MATCH_ALL_FIELDS = ALBUM_FIELDS.filter((f): f is (typeof ALBUM_FIELDS)[number] & { field: AlbumMatchAllField } => f.field !== "tracks");

type Filter = "review" | "applied" | "none";
const FILTER_LABEL: Record<Filter, string> = { review: "To review", applied: "Applied", none: "No match" };

export function AlbumMatchAll({ albums, children }: { albums: AlbumSummary[]; children: React.ReactNode }) {
  const router = useRouter();
  const [job, setJob] = useState<AlbumMatchAllDto | null>(null);
  const [starting, setStarting] = useState(false);
  const [fields, setFields] = useState<Set<AlbumMatchAllField>>(new Set(DEFAULT_FIELDS));
  const [filter, setFilter] = useState<Filter>("review");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState<AlbumSummary | null>(null);
  const seen = useRef(new Set<string>());
  const unmatched = albums.length;

  // New review results that are sure enough start ticked; ones you've seen keep your choice.
  const adopt = (next: AlbumMatchAllDto | null) => {
    setJob(next);
    if (!next) return;
    const fresh = next.items.filter((i) => i.status === "review" && !seen.current.has(i.albumId));
    if (fresh.length === 0) return;
    for (const i of fresh) seen.current.add(i.albumId);
    setPicked((p) => {
      const out = new Set(p);
      for (const i of fresh) if ((i.candidate?.score ?? 0) >= PICK_AT) out.add(i.albumId);
      return out;
    });
  };

  useEffect(() => {
    void api<AlbumMatchAllDto | null>(PATH).then(adopt, () => undefined);
  }, []);

  // Poll while it runs; when it finishes, refresh so matched albums leave the list.
  const running = !!job?.running;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void api<AlbumMatchAllDto | null>(PATH).then((next) => {
        adopt(next);
        if (!next?.running) router.refresh();
      }, () => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, router]);

  const run = async (fn: () => Promise<AlbumMatchAllDto | null>, done?: string) => {
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
      const next = await api<AlbumMatchAllDto>(PATH, { method: "POST", body: { fields: [...fields] } });
      setStarting(false);
      return next;
    });

  const dialog = searching ? (
    <AlbumMatchDialog
      album={searching}
      onClose={() => setSearching(null)}
      onApplied={() => {
        setSearching(null);
        toast("Match applied");
        router.refresh();
      }}
    />
  ) : null;

  // Until a run starts, the unmatched albums themselves show below the button.
  if (!job) {
    if (unmatched === 0) return children;
    return (
      <>
        <div className="bulk-bar">
          <span className="muted small">{plural(unmatched, "album")} not matched</span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setFields(new Set((lastAlbumFields() ?? DEFAULT_FIELDS).filter((f): f is AlbumMatchAllField => f !== "tracks")));
              setStarting(true);
            }}
          >
            Match all
          </button>
        </div>
        <Sheet open={starting} onClose={() => setStarting(false)} title={`Match ${plural(unmatched, "album")}`}>
          <p className="sheet-note">Each album is searched and its best result shown for you to check. Nothing changes until you apply.</p>
          <div className="sheet-group">
            <span className="sheet-group-title">Fields to take</span>
            <Chips wrap>
              {MATCH_ALL_FIELDS.map(({ field, label }) => (
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
            <span className="muted small">Covers are only changed when the new one is bigger.</span>
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
  const pickedReview = by("review").filter((i) => picked.has(i.albumId));
  const apply = (albumIds: string[]) =>
    void run(
      () => api(`${PATH}/apply`, { method: "POST", body: { albumIds } }),
      albumIds.length === 1 ? "Matched" : `${plural(albumIds.length, "album")} matched`,
    ).then(() => router.refresh());

  return (
    <div className="bulk">
      {job.running ? (
        <div className="card-box bulk-progress">
          <div className="bulk-progress-head">
            <strong>Matching {plural(job.total, "album")}</strong>
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
          <strong>Matched {plural(job.total, "album")}</strong>
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
            onClick={() => apply(pickedReview.map((i) => i.albumId))}
          >
            {pickedReview.length ? `Apply ${pickedReview.length}` : "Pick some"}
          </button>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <EmptyState>{job.running ? "Nothing here yet." : `No albums under ${FILTER_LABEL[filter].toLowerCase()}.`}</EmptyState>
      ) : (
        <div>
          {shown.map((item) => (
            <MatchAllRow
              key={item.albumId}
              item={item}
              picked={picked.has(item.albumId)}
              busy={busy}
              onPick={(on) =>
                setPicked((p) => {
                  const out = new Set(p);
                  if (on) out.add(item.albumId);
                  else out.delete(item.albumId);
                  return out;
                })
              }
              onUndo={() =>
                void run(() => api(`${PATH}/undo`, { method: "POST", body: { albumId: item.albumId } }), "Put back").then(() => router.refresh())
              }
              onApply={() => apply([item.albumId])}
              onSearch={() => {
                const album = albums.find((a) => a.id === item.albumId);
                if (album) setSearching(album);
              }}
            />
          ))}
        </div>
      )}
      {dialog}
    </div>
  );
}

function MatchAllRow({
  item,
  picked,
  busy,
  onPick,
  onUndo,
  onApply,
  onSearch,
}: {
  item: AlbumMatchAllItem;
  picked: boolean;
  busy: boolean;
  onPick: (on: boolean) => void;
  onUndo: () => void;
  onApply: () => void;
  onSearch: () => void;
}) {
  const [open, setOpen] = useState(false);
  const c = item.candidate;
  const sub = c ? [ALBUM_PROVIDER_NAME[c.provider], c.artist, c.trackCount ? plural(c.trackCount, "song") : null].filter(Boolean).join(", ") : null;
  const main = (
    <>
      <span className="list-row-title">{c ? c.title : item.title}</span>
      {c && c.title !== item.title ? <span className="list-row-meta">Yours: {item.title}</span> : null}
      {sub ? <span className="list-row-sub">{sub}</span> : null}
      {item.status === "applied" ? (
        <span className="list-row-sub">
          {item.applied.length
            ? `Changed ${item.applied.map((f) => ALBUM_FIELDS.find((x) => x.field === f)?.label.toLowerCase()).join(", ")}`
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
          <Cover src={albumCover(item.albumId, item.coverHash)} color={item.coverColor} title={item.title} />
          {c ? (
            <>
              <span className="muted" aria-hidden="true">
                →
              </span>
              {c.thumbUrl ? <img src={c.thumbUrl} alt="" loading="lazy" /> : <div className="bulk-nocover" />}
            </>
          ) : null}
        </div>
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
              {item.status === "none" ? "Search" : "Search again"}
            </button>
            {item.status === "review" ? (
              <button type="button" className="btn btn-small btn-primary" disabled={busy} onClick={onApply}>
                Apply
              </button>
            ) : null}
          </div>
        )}
      </div>
      {open && c ? <MatchAllChanges item={item} /> : null}
    </div>
  );
}

/** Each field the result changes, from what the album has now to what it would get. */
function MatchAllChanges({ item }: { item: AlbumMatchAllItem }) {
  if (item.changes.length === 0) return <div className="bulk-changes muted small">Nothing would change.</div>;
  return (
    <dl className="bulk-changes">
      {item.changes.map((x) => (
        <div key={x.field}>
          <dt>{ALBUM_FIELDS.find((f) => f.field === x.field)?.label}</dt>
          <dd>
            <span className="bulk-from">{x.from ?? "None"}</span>
            <span className="muted" aria-label="to">
              →
            </span>
            <span>{x.to}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
