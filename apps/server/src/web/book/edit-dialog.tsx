"use client";

/* eslint-disable @next/next/no-img-element -- provider cover suggestions are remote */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  apiPaths,
  type BookEditInfo,
  type BookEditValues,
  type ChapterDto,
  duration,
  type MatchSearchResult,
  errorText,
} from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { CloseIcon, MinusIcon, PlusIcon } from "../icons";
import { useBackdropClose } from "../sheet";
import { MatchPanel } from "./match-dialog";

export type EditTab = "details" | "cover" | "chapters" | "match" | "files";

const TABS: Array<{ id: EditTab; label: string }> = [
  { id: "details", label: "Details" },
  { id: "cover", label: "Cover" },
  { id: "chapters", label: "Chapters" },
  { id: "match", label: "Match" },
  { id: "files", label: "Files" },
];

const PROVIDER_NAME = { audible: "Audible", google: "Google Books", itunes: "Apple Books" } as const;

interface Form {
  title: string;
  author: string;
  narrator: string;
  series: string;
  seriesPosition: string;
  year: string;
  description: string;
}

function formOf(info: BookEditInfo): Form {
  const b = info.book;
  return {
    title: b.title,
    author: b.author ?? "",
    narrator: b.narrator ?? "",
    series: b.series ?? "",
    seriesPosition: b.seriesPosition === null ? "" : String(b.seriesPosition),
    year: b.year ?? "",
    description: b.description ?? "",
  };
}

function scannedText(s: BookEditValues, f: keyof Form): string {
  if (f === "seriesPosition") return s.seriesPosition === null ? "" : String(s.seriesPosition);
  return s[f] ?? "";
}

/** "1:02:03", "62:03" or "3723" to seconds; null when it can't be read. */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((sum, p) => sum * 60 + Number(p), 0);
}

export function formatClock(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** `sec` is the exact original start, kept when the shown (rounded) time isn't changed. */
type Row = { title: string; start: string; sec?: number };
const rowsOf = (chapters: ChapterDto[]): Row[] => chapters.map((c) => ({ title: c.title, start: formatClock(c.startSec), sec: c.startSec }));
const startOf = (r: Row) => (r.sec !== undefined && r.start === formatClock(r.sec) ? r.sec : parseClock(r.start));
const sameRows = (a: Row[], b: Row[]) => a.length === b.length && a.every((r, i) => r.title === b[i]!.title && r.start === b[i]!.start);

/**
 * The admin's edit dialog for one book: details, cover, chapters, match and files.
 * Details and chapters are saved with Save; cover, match and file actions apply at once.
 */
export function EditBookDialog({
  bookId,
  open,
  tab: initialTab = "details",
  onClose,
  onChanged,
}: {
  bookId: string;
  open: boolean;
  tab?: EditTab;
  onClose: () => void;
  onChanged: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropClose = useBackdropClose(onClose);
  const [tab, setTab] = useState<EditTab>(initialTab);
  const [info, setInfo] = useState<BookEditInfo | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adopt = useCallback((next: BookEditInfo) => {
    setInfo(next);
    setForm(formOf(next));
    setRows(rowsOf(next.book.chapters));
  }, []);

  const load = useCallback(async () => {
    try {
      adopt(await api<BookEditInfo>(`/api/books/${bookId}/edit`));
    } catch (err) {
      setError(errorText(err));
    }
  }, [bookId, adopt]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      setTab(initialTab);
      setError(null);
      void load();
    }
    if (!open && el.open) el.close();
  }, [open, initialTab, load]);

  const detailsDirty = !!(info && form && JSON.stringify(form) !== JSON.stringify(formOf(info)));
  const chaptersDirty = !!(info && !sameRows(rows, rowsOf(info.book.chapters)));

  /** Runs an action that returns fresh edit info, then refreshes the page behind. */
  const act = async (fn: () => Promise<BookEditInfo | void>, done: string) => {
    setBusy(true);
    try {
      const next = await fn();
      if (next) adopt(next);
      else await load();
      toast(done);
      onChanged();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    act(async () => {
      let next: BookEditInfo | undefined;
      if (detailsDirty && form) {
        const position = form.seriesPosition.trim() ? Number(form.seriesPosition) : null;
        if (position !== null && !Number.isFinite(position)) throw new Error("Book number has to be a number, like 2 or 2.5.");
        next = await api<BookEditInfo>(`/api/books/${bookId}/details`, {
          method: "PUT",
          body: { ...form, seriesPosition: position },
        });
      }
      if (chaptersDirty) {
        const chapters = rows.map((r, i) => {
          const startSec = startOf(r);
          if (startSec === null) throw new Error(`Chapter ${i + 1}: start time should look like 1:02:03.`);
          if (!r.title.trim()) throw new Error(`Chapter ${i + 1} needs a name.`);
          return { title: r.title.trim(), startSec };
        });
        next = await api<BookEditInfo>(`/api/books/${bookId}/chapters`, { method: "PUT", body: { chapters } });
      }
      return next;
    }, "Saved");

  return (
    <dialog
      ref={ref}
      className="sheet wide"
      aria-label="Edit book"
      onClose={onClose}
      {...backdropClose}
    >
      {open ? (
        <div className="edit">
          <div className="edit-head">
            {info ? (
              <Cover
                className="edit-thumb"
                src={info.book.coverHash ? apiPaths.coverUrl(info.book.id, info.book.coverHash, 200) : null}
                color={info.book.coverColor}
                title={info.book.title}
              />
            ) : (
              <div className="cover edit-thumb" />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sheet-title" style={{ padding: 0 }}>
                Edit book
              </div>
              <div className="muted small edit-sub">{info ? [info.book.title, info.book.author].filter(Boolean).join(", ") : "Loading…"}</div>
              {info ? (
                <div className="muted small edit-sub">
                  Your files: {duration(info.book.durationSec)}
                  {info.book.asin ? `, ASIN ${info.book.asin}` : ""}
                </div>
              ) : null}
            </div>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>

          <div className="subtabs edit-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" className="subtab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label}
                {(t.id === "details" && detailsDirty) || (t.id === "chapters" && chaptersDirty) ? <span className="dirty-dot" aria-label="unsaved" /> : null}
              </button>
            ))}
          </div>

          <div className="edit-body">
            {/* Only a failed load shows here, in place of the tabs; other failures are toasts. */}
            {error && !info ? (
              <p className="error small" role="alert" style={{ marginTop: 0 }}>
                {error}
              </p>
            ) : !info || !form ? (
              <div className="loading-center" aria-busy="true" aria-label="Loading">
                <div className="spinner" />
              </div>
            ) : tab === "details" ? (
              <DetailsTab info={info} form={form} setForm={setForm} />
            ) : tab === "cover" ? (
              <CoverTab info={info} busy={busy} act={act} />
            ) : tab === "chapters" ? (
              <ChaptersTab info={info} rows={rows} setRows={setRows} busy={busy} act={act} />
            ) : tab === "match" ? (
              <MatchPanel
                book={info.book}
                onApplied={() => {
                  void act(async () => undefined, "Match applied");
                  setTab("details");
                }}
              />
            ) : (
              <FilesTab info={info} busy={busy} act={act} />
            )}
          </div>

          <div className="edit-foot">
            {detailsDirty || chaptersDirty ? (
              <span className="muted small" style={{ flex: 1 }}>
                Unsaved changes
              </span>
            ) : null}
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || !(detailsDirty || chaptersDirty)} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

type Act = (fn: () => Promise<BookEditInfo | void>, done: string) => Promise<void>;

const FIELD_LABELS: Record<keyof Form, string> = {
  title: "Title",
  author: "Author",
  narrator: "Narrator",
  series: "Series",
  seriesPosition: "Book number",
  year: "Year",
  description: "Description",
};

function DetailsTab({ info, form, setForm }: { info: BookEditInfo; form: Form; setForm: (f: Form) => void }) {
  const field = (f: keyof Form, opts: { wide?: boolean; multiline?: boolean; placeholder?: string } = {}) => {
    const scanned = scannedText(info.scanned, f);
    const saved = formOf(info)[f];
    const changed = form[f].trim() !== scanned;
    // Unsaved typing can be undone; a saved edit can be reset to what the files say.
    const unsaved = form[f] !== saved;
    const id = `edit-${f}`;
    return (
      <div className={`edit-field ${opts.wide ? "wide" : ""}`}>
        <div className="edit-label">
          <label htmlFor={id}>{FIELD_LABELS[f]}</label>
          {changed ? <span className="edited-dot" role="img" aria-label="Edited" title="Edited, differs from the files" /> : null}
          {unsaved ? (
            <button type="button" className="link-btn" onClick={() => setForm({ ...form, [f]: saved })}>
              Undo
            </button>
          ) : changed ? (
            <button type="button" className="link-btn" onClick={() => setForm({ ...form, [f]: scanned })}>
              Reset
            </button>
          ) : null}
        </div>
        {opts.multiline ? (
          <textarea id={id} className="input" rows={6} value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} />
        ) : (
          <input
            id={id}
            className="input"
            value={form[f]}
            placeholder={opts.placeholder}
            inputMode={f === "seriesPosition" ? "decimal" : undefined}
            onChange={(e) => setForm({ ...form, [f]: e.target.value })}
          />
        )}
        {changed && !opts.multiline ? <span className="edit-hint">Files say: {scanned || "nothing"}</span> : null}
      </div>
    );
  };
  return (
    <div className="edit-grid">
      {field("title", { wide: true })}
      {field("author")}
      {field("narrator")}
      {field("series", { placeholder: "None" })}
      <div className="edit-pair">
        {field("seriesPosition", { placeholder: "1" })}
        {field("year")}
      </div>
      {field("description", { wide: true, multiline: true })}
    </div>
  );
}

function CoverTab({ info, busy, act }: { info: BookEditInfo; busy: boolean; act: Act }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [suggestions, setSuggestions] = useState<MatchSearchResult | null>(null);
  const book = info.book;

  useEffect(() => {
    let live = true;
    api<MatchSearchResult>(`/api/books/${book.id}/match`).then(
      (r) => live && setSuggestions(r),
      () => live && setSuggestions({ query: { title: "", author: null, asin: null }, candidates: [], suggested: null, errors: [] }),
    );
    return () => {
      live = false;
    };
  }, [book.id]);

  const upload = (file: File) =>
    act(async () => {
      const body = new FormData();
      body.set("image", file);
      const res = await fetch(`/api/books/${book.id}/cover`, { method: "POST", body });
      const data = (await res.json().catch(() => null)) as (BookEditInfo & { error?: string }) | null;
      if (!res.ok) throw new Error(data?.error ?? `Upload failed (${res.status}).`);
      return data as BookEditInfo;
    }, "Cover updated");

  const fromUrl = (u: string) =>
    act(() => api<BookEditInfo>(`/api/books/${book.id}/cover`, { method: "POST", body: { url: u } }), "Cover updated");

  const covers = (suggestions?.candidates ?? []).filter((c) => c.coverUrl).slice(0, 8);

  return (
    <div className="cover-tab">
      <div className="cover-current">
        <Cover
          src={book.coverHash ? apiPaths.coverUrl(book.id, book.coverHash, 600) : null}
          color={book.coverColor}
          title={book.title}
          subtitle={book.author}
          large
        />
        <span className="muted small">
          {info.coverSource === "custom" ? "Custom cover" : info.coverSource === "files" ? "From the files" : "No cover yet"}
        </span>
        {info.coverSource === "custom" ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void act(() => api<BookEditInfo>(`/api/books/${book.id}/cover`, { method: "DELETE" }), "Using the files' cover")}
          >
            {info.scannedCoverHash ? "Use the files' cover" : "Remove custom cover"}
          </button>
        ) : null}
      </div>
      <div className="cover-options">
        <button
          type="button"
          className={`cover-drop ${dragging ? "over" : ""}`}
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) void upload(file);
          }}
        >
          <strong>Upload an image</strong>
          <span className="muted small">Drop a JPG, PNG or WebP here, or click to choose one</span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
        <form
          className="form-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) void fromUrl(url.trim()).then(() => setUrl(""));
          }}
        >
          <input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Or paste an image link" aria-label="Image link" />
          <button type="submit" className="btn" disabled={busy || !url.trim()}>
            Use link
          </button>
        </form>
        <div className="edit-label">Suggestions</div>
        {suggestions === null ? (
          <div className="cover-suggest" aria-busy="true" aria-label="Looking for covers">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skel skel-cover" />
            ))}
          </div>
        ) : covers.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            No covers found online.
          </p>
        ) : (
          <div className="cover-suggest">
            {covers.map((c) => (
              <button
                key={`${c.provider}:${c.providerId}`}
                type="button"
                disabled={busy}
                onClick={() => void fromUrl(c.coverUrl!)}
                aria-label={`Use the ${PROVIDER_NAME[c.provider]} cover of ${c.title}`}
              >
                <img src={c.coverUrl!} alt="" loading="lazy" />
                <span className="small">{PROVIDER_NAME[c.provider]}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChaptersTab({
  info,
  rows,
  setRows,
  busy,
  act,
}: {
  info: BookEditInfo;
  rows: Row[];
  setRows: (r: Row[]) => void;
  busy: boolean;
  act: Act;
}) {
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="form">
      <div className="chapter-tools">
        <span className="muted small" style={{ flex: 1 }}>
          {info.chaptersEdited ? "Edited or matched chapters." : `${info.scannedChapters.length} chapters from the files.`}
        </span>
        <button type="button" className="btn" onClick={() => setRows(rows.map((r, i) => ({ ...r, title: `Chapter ${i + 1}` })))}>
          Number them
        </button>
        {info.chaptersEdited ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void act(() => api<BookEditInfo>(`/api/books/${info.book.id}/chapters`, { method: "PUT", body: { chapters: null } }), "Using the files' chapters")}
          >
            Use the files&apos; chapters
          </button>
        ) : null}
      </div>
      <ol className="chapter-edit">
        {rows.map((r, i) => (
          <li key={i}>
            <span className="chapter-num">{i + 1}</span>
            <input className="input" value={r.title} aria-label={`Chapter ${i + 1} name`} onChange={(e) => set(i, { title: e.target.value })} />
            <input
              className="input clock"
              value={i === 0 ? "0:00:00" : r.start}
              disabled={i === 0}
              aria-label={`Chapter ${i + 1} start`}
              aria-invalid={parseClock(r.start) === null || undefined}
              onChange={(e) => set(i, { start: e.target.value })}
            />
            <button type="button" className="icon-btn" aria-label={`Remove chapter ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              <MinusIcon size={18} />
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="btn"
        style={{ alignSelf: "flex-start" }}
        onClick={() => {
          const last = rows.at(-1);
          const lastStart = last ? (parseClock(last.start) ?? 0) : 0;
          const start = Math.min(info.book.durationSec - 1, lastStart + 600);
          setRows([...rows, { title: `Chapter ${rows.length + 1}`, start: formatClock(start) }]);
        }}
      >
        <PlusIcon size={18} />
        Add chapter
      </button>
    </div>
  );
}

function FilesTab({ info, busy, act }: { info: BookEditInfo; busy: boolean; act: Act }) {
  const [confirmUndo, setConfirmUndo] = useState(false);
  const hasEdits = info.edited.length > 0 || info.chaptersEdited || info.coverSource === "custom" || !!info.book.match;
  return (
    <div className="form">
      <div>
        <div className="edit-label">Folder</div>
        <div className="folder-path">{info.folder ?? "Its library folder was removed."}</div>
      </div>
      <ul className="file-list">
        {info.files.map((f) => (
          <li key={f.name}>
            <span className="folder-path file-name">{f.name}</span>
            <span className="muted small">
              {duration(f.durationSec)}, {formatSize(f.size)}
              {f.durationSec > 0 ? `, ${Math.round((f.size * 8) / f.durationSec / 1000)} kbps` : ""}
            </span>
          </li>
        ))}
      </ul>
      <div className="chapter-tools">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              await api(`/api/books/${info.book.id}/rescan`, { method: "POST" });
            }, "Rescanning. Changes show in a moment.")
          }
        >
          Rescan files
        </button>
        {hasEdits ? (
          confirmUndo ? (
            <>
              <button type="button" className="btn" onClick={() => setConfirmUndo(false)}>
                Keep edits
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api(`/api/books/${info.book.id}/match`, { method: "DELETE" });
                    setConfirmUndo(false);
                  }, "Back to the files' details")
                }
              >
                Undo every edit and match
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmUndo(true)}>
              Undo all edits
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}
