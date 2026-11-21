"use client";

/* eslint-disable @next/next/no-img-element -- provider cover suggestions are remote */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "../toast";
import {
  apiPaths,
  BOOK_FIELD_LABELS,
  BOOK_PROVIDER_NAME,
  type BookEditForm,
  type BookEditInfo,
  bookFormOf,
  changedFields,
  changedRows,
  type ChapterRow,
  chapterRowsOf,
  chapterStartOf,
  duration,
  formatClock,
  formatSize,
  parseClock,
  sameChapterRow,
  scannedText,
  saveLabel,
  type KnownSeries,
  type MatchSearchResult,
  errorText,
  plural,
  suggestSeries,
} from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { MinusIcon, PlusIcon, RefreshIcon } from "../icons";
import { RemoveBooksSheet } from "../library/selection";
import { PicturePicker } from "../picture-picker";
import { useSheetDialog } from "../sheet";
import { MatchPanel } from "./match-dialog";

export type EditTab = "details" | "cover" | "chapters" | "match" | "files";

const TABS: Array<{ id: EditTab; label: string }> = [
  { id: "details", label: "Details" },
  { id: "cover", label: "Cover" },
  { id: "chapters", label: "Chapters" },
  { id: "match", label: "Match" },
  { id: "files", label: "Files" },
];

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
  onRemoved,
}: {
  bookId: string;
  open: boolean;
  tab?: EditTab;
  onClose: () => void;
  onChanged: () => void;
  /** After the book is removed from the library; by default the dialog closes and the list refreshes. */
  onRemoved?: () => void;
}) {
  const [tab, setTab] = useState<EditTab>(initialTab);
  const [info, setInfo] = useState<BookEditInfo | null>(null);
  const [form, setForm] = useState<BookEditForm | null>(null);
  const [rows, setRows] = useState<ChapterRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adopt = useCallback((next: BookEditInfo) => {
    setInfo(next);
    setForm(bookFormOf(next));
    setRows(chapterRowsOf(next.book.chapters));
  }, []);

  const load = useCallback(async () => {
    try {
      adopt(await api<BookEditInfo>(apiPaths.bookEdit(bookId)));
    } catch (err) {
      setError(errorText(err));
    }
  }, [bookId, adopt]);

  const { dialogProps, drag, sinking } = useSheetDialog({ open, onClose });
  // Each time it opens: the asked-for tab, fresh from the server.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setTab(initialTab);
      setError(null);
      void load();
    }
    wasOpen.current = open;
  }, [open, initialTab, load]);

  const detailChanges = info && form ? changedFields(form, bookFormOf(info)) : 0;
  const chapterChanges = info ? changedRows(rows, chapterRowsOf(info.book.chapters), sameChapterRow) : 0;
  const detailsDirty = detailChanges > 0;
  const chaptersDirty = chapterChanges > 0;

  /** Runs an action that returns fresh edit info, then refreshes the page behind. Resolves whether it worked. */
  const act: Act = async (fn, done) => {
    setBusy(true);
    try {
      const next = await fn();
      if (next) adopt(next);
      else await load();
      toast(done);
      onChanged();
      return true;
    } catch (err) {
      toast.error(errorText(err));
      return false;
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
        next = await api<BookEditInfo>(apiPaths.bookDetails(bookId), {
          method: "PUT",
          body: { ...form, seriesPosition: position },
        });
      }
      if (chaptersDirty) {
        const chapters = rows.map((r, i) => {
          const startSec = chapterStartOf(r);
          if (startSec === null) throw new Error(`Chapter ${i + 1}: start time should look like 1:02:03.`);
          if (!r.title.trim()) throw new Error(`Chapter ${i + 1} needs a name.`);
          return { title: r.title.trim(), startSec };
        });
        next = await api<BookEditInfo>(apiPaths.bookChapters(bookId), { method: "PUT", body: { chapters } });
      }
      return next;
    }, "Saved");

  return (
    <dialog className="sheet wide" aria-label="Edit book" {...dialogProps}>
      {open || sinking ? (
        <div className="edit">
          <div className="sheet-grab" aria-hidden="true" {...drag} />
          <div className="edit-head" {...drag}>
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
              // No spinner: the tab fades in once the book has loaded.
              <div aria-busy="true" aria-label="Loading" />
            ) : (
              <div key={tab} className="view-fade edit-tab">
                {tab === "details" ? (
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
                  <FilesTab info={info} busy={busy} act={act} onRemoved={onRemoved ?? (() => (onChanged(), onClose()))} />
                )}
              </div>
            )}
          </div>

          {/* Save is for the details and chapters; the cover, Match and files act on their own. */}
          {tab === "details" || tab === "chapters" ? (
            <div className="edit-foot">
              <button type="button" className="btn btn-primary" disabled={busy || !(detailsDirty || chaptersDirty)} onClick={() => void save()}>
                {busy ? "Saving…" : saveLabel(detailChanges + chapterChanges)}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}

type Act = (fn: () => Promise<BookEditInfo | void>, done: string) => Promise<boolean>;

function DetailsTab({ info, form, setForm }: { info: BookEditInfo; form: BookEditForm; setForm: (f: BookEditForm) => void }) {
  const field = (f: keyof BookEditForm, opts: { wide?: boolean; multiline?: boolean; placeholder?: string } = {}) => {
    const scanned = scannedText(info.scanned, f);
    const saved = bookFormOf(info)[f];
    const changed = form[f].trim() !== scanned;
    // Unsaved typing can be undone; a saved edit can be reset to what the files say.
    const unsaved = form[f] !== saved;
    const id = `edit-${f}`;
    return (
      <div className={`edit-field ${opts.wide ? "wide" : ""}`}>
        <div className="edit-label">
          <label htmlFor={id}>{BOOK_FIELD_LABELS[f]}</label>
          {changed ? (
            <span className="edited-tag">
              <span className="edited-dot" aria-hidden="true" />
              Edited
            </span>
          ) : null}
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
        ) : f === "series" ? (
          <SeriesInput id={id} value={form.series} placeholder={opts.placeholder} known={info.knownSeries} onChange={(series) => setForm({ ...form, series })} />
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

/** The series field, offering the library's existing series as you type so books land in the same one. */
export function SeriesInput({
  id,
  value,
  placeholder,
  known,
  onChange,
}: {
  id: string;
  value: string;
  placeholder?: string;
  known: KnownSeries[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const hits = open ? suggestSeries(known, value) : [];
  const listId = `${id}-list`;
  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };
  return (
    <div className="suggest-wrap">
      <input
        id={id}
        className="input"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={hits.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={hits.length ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!hits.length) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(hits[active]!.name);
          } else if (e.key === "Escape") {
            // Closes the list, not the dialog.
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {hits.length ? (
        <ul id={listId} className="suggest" role="listbox" aria-label="Series in your library">
          {hits.map((s, i) => (
            <li
              key={s.name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, so the pick lands before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s.name);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="suggest-name" title={s.name}>
                {s.name}
              </span>
              <span className="muted small">{plural(s.books, "book")}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CoverTab({ info, busy, act }: { info: BookEditInfo; busy: boolean; act: Act }) {
  const [suggestions, setSuggestions] = useState<MatchSearchResult | null>(null);
  const book = info.book;

  useEffect(() => {
    let live = true;
    api<MatchSearchResult>(apiPaths.bookMatch(book.id)).then(
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
      const res = await fetch(apiPaths.bookCover(book.id), { method: "POST", body });
      const data = (await res.json().catch(() => null)) as (BookEditInfo & { error?: string }) | null;
      if (!res.ok) throw new Error(data?.error ?? `Upload failed (${res.status}).`);
      return data as BookEditInfo;
    }, "Cover updated");

  const fromUrl = (u: string) =>
    act(() => api<BookEditInfo>(apiPaths.bookCover(book.id), { method: "POST", body: { url: u } }), "Cover updated");

  const covers = (suggestions?.candidates ?? []).filter((c) => c.coverUrl).slice(0, 8);

  return (
    <PicturePicker
      shape="square"
      current={
        <Cover src={book.coverHash ? apiPaths.coverUrl(book.id, book.coverHash, 600) : null} color={book.coverColor} title={book.title} subtitle={book.author} large />
      }
      source={info.coverSource === "custom" ? "Custom cover" : info.coverSource === "files" ? "From the files" : "No cover yet"}
      reset={
        info.coverSource === "custom"
          ? {
              label: info.scannedCoverHash ? "Use the files' cover" : "Remove this cover",
              onClick: () => void act(() => api<BookEditInfo>(apiPaths.bookCover(book.id), { method: "DELETE" }), "Using the files' cover"),
            }
          : undefined
      }
      suggestions={suggestions === null ? null : covers.map((c) => ({ key: c.coverUrl!, src: c.coverUrl!, label: BOOK_PROVIDER_NAME[c.provider] }))}
      emptyText="No covers found online."
      busy={busy}
      onUpload={upload}
      onLink={fromUrl}
      onPick={fromUrl}
    />
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
  rows: ChapterRow[];
  setRows: (r: ChapterRow[]) => void;
  busy: boolean;
  act: Act;
}) {
  const set = (i: number, patch: Partial<ChapterRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
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
            onClick={() => void act(() => api<BookEditInfo>(apiPaths.bookChapters(info.book.id), { method: "PUT", body: { chapters: null } }), "Using the files' chapters")}
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

function FilesTab({ info, busy, act, onRemoved }: { info: BookEditInfo; busy: boolean; act: Act; onRemoved: () => void }) {
  const [confirm, setConfirm] = useState<"undo" | null>(null);
  const [asking, setAsking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const hasEdits = info.edited.length > 0 || info.chaptersEdited || info.coverSource === "custom" || !!info.book.match;
  const remove = async () => {
    setRemoving(true);
    try {
      await api(apiPaths.book(info.book.id), { method: "DELETE" });
      toast("Removed from the library");
      onRemoved();
    } catch (err) {
      toast.error(errorText(err));
      setRemoving(false);
    }
  };
  const missing = info.book.missingSince !== null;
  return (
    <div className="form">
      <div>
        <div className="edit-label">Folder</div>
        <div className="folder-path">{info.folder ?? "Its library folder was removed."}</div>
      </div>
      {missing ? <p className="error small">These files are missing.</p> : null}
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
      <RemoveBooksSheet open={asking} books={[info.book]} busy={removing} onConfirm={() => void remove()} onClose={() => setAsking(false)} />
      <div className="chapter-tools">
        {confirm === "undo" ? (
          <>
            <button type="button" className="btn" onClick={() => setConfirm(null)}>
              Keep edits
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api(apiPaths.bookMatch(info.book.id), { method: "DELETE" });
                  setConfirm(null);
                }, "Back to the files' details")
              }
            >
              Undo every edit and match
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api(apiPaths.bookRescan(info.book.id), { method: "POST" });
                }, "Rescanning. Changes show in a moment.")
              }
            >
              <RefreshIcon size={18} />
              Rescan files
            </button>
            {hasEdits && !missing ? (
              <button type="button" className="btn btn-danger" onClick={() => setConfirm("undo")}>
                Undo all edits
              </button>
            ) : null}
            <button type="button" className="btn btn-danger" onClick={() => setAsking(true)}>
              Remove from library…
            </button>
          </>
        )}
      </div>
    </div>
  );
}
