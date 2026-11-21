"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "../toast";
import {
  apiPaths,
  BULK_EDIT_FIELDS,
  bulkChanges,
  bulkForm,
  bulkStart,
  type BookSummary,
  type BulkEditField,
  type BulkEditForm,
  errorText,
  type KnownSeries,
  MIXED,
  pickRange,
  plural,
  removeConfirm,
  saveLabel,
  selectedLabel,
  togglePick,
} from "@murmur/shared/client";
import { useAdmin } from "../admin";
import { api } from "../api";
import { SeriesInput } from "../book/edit-dialog";
import { Cover } from "../cover";
import { CheckIcon, CloseIcon, EyeOffIcon, MoreIcon, PencilIcon, TrashIcon } from "../icons";
import { setManyFinished } from "../progress";
import { ConfirmSheet, Sheet, SheetItem } from "../sheet";
import { HIDDEN_CHANGED } from "../hidden";

interface Selection {
  selecting: boolean;
  picked: ReadonlySet<string>;
  /** A card's click while selecting; shift picks the run from the last one picked. */
  pick: (id: string, shift: boolean) => void;
  /** Starts selecting, with this card already picked when it came from its menu. */
  start: (id?: string) => void;
}

/** Set around a full grid of books that can be picked several at a time. Cards and their menus read it. */
export const SelectionContext = createContext<Selection | null>(null);
export const useSelection = () => useContext(SelectionContext);

/**
 * Books whose cards can be picked several at a time, with the bar of what to do with them.
 * `books` is in the order the cards show, each once, for shift-click runs and Select all; a book
 * on two shelves is picked in both. A new `view` (another tab) stops selecting.
 */
export function SelectionProvider({ books, view, children }: { books: BookSummary[]; view?: string; children: React.ReactNode }) {
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const order = useMemo(() => books.map((b) => b.id), [books]);

  const stop = useCallback(() => {
    setSelecting(false);
    setPicked(new Set());
    anchor.current = null;
  }, []);

  useEffect(() => stop(), [view, stop]);

  const value = useMemo<Selection>(
    () => ({
      selecting,
      picked,
      pick: (id, shift) => {
        // Read the anchor now: React runs the updater later, after it has moved on.
        const from = anchor.current;
        setPicked((p) => (shift ? pickRange(order, p, from, id) : togglePick(p, id)));
        anchor.current = id;
      },
      start: (id) => {
        setSelecting(true);
        setPicked(id ? new Set([id]) : new Set());
        anchor.current = id ?? null;
      },
    }),
    [selecting, picked, order],
  );

  // Esc leaves, unless a sheet over the grid has it.
  useEffect(() => {
    if (!selecting) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) stop();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [selecting, stop]);

  // Books that leave the list (removed, hidden) leave the selection too.
  useEffect(() => {
    setPicked((p) => {
      const kept = [...p].filter((id) => order.includes(id));
      return kept.length === p.size ? p : new Set(kept);
    });
  }, [order]);

  return (
    <SelectionContext.Provider value={value}>
      {selecting ? <SelectBar books={books} picked={picked} onAll={() => setPicked(new Set(order))} onStop={stop} /> : null}
      {children}
    </SelectionContext.Provider>
  );
}

function SelectBar({ books, picked, onAll, onStop }: { books: BookSummary[]; picked: ReadonlySet<string>; onAll: () => void; onStop: () => void }) {
  const router = useRouter();
  const { isAdmin } = useAdmin();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const chosen = useMemo(() => books.filter((b) => picked.has(b.id)), [books, picked]);
  const none = chosen.length === 0;
  const allFinished = !none && chosen.every((b) => b.progress?.finished);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      onStop();
      router.refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const markFinished = () =>
    run(async () => {
      const done = !allFinished;
      // Undo puts each book back where it was, not at the start.
      const before = chosen.map((b) => ({ ...b.progress, id: b.id, durationSec: b.durationSec }));
      await setManyFinished(chosen.map((b) => ({ itemType: "book" as const, itemId: b.id, durationSec: b.durationSec })), done);
      toast(done ? `Marked ${plural(chosen.length, "book")} as finished` : `Marked ${plural(chosen.length, "book")} as not finished`, {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            const updatedAt = Date.now();
            void api(apiPaths.progress, {
              method: "PUT",
              body: {
                items: before.map((b) => ({
                  itemType: "book",
                  itemId: b.id,
                  durationSec: b.durationSec,
                  positionSec: b.positionSec ?? 0,
                  finished: !!b.finished,
                  updatedAt,
                })),
              },
            }).then(() => router.refresh(), (err: unknown) => toast.error(errorText(err)));
          },
        },
      });
    });

  const hide = () =>
    run(async () => {
      const ids = chosen.map((b) => b.id);
      await api(apiPaths.booksBulk, { method: "POST", body: { action: "hide", ids } });
      window.dispatchEvent(new Event(HIDDEN_CHANGED));
      toast(`Hid ${plural(ids.length, "book")}`, {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () =>
            void Promise.all(ids.map((id) => api(apiPaths.hidden, { method: "DELETE", body: { kind: "book", id } }))).then(
              () => {
                router.refresh();
                window.dispatchEvent(new Event(HIDDEN_CHANGED));
              },
              (err: unknown) => toast.error(errorText(err)),
            ),
        },
      });
    });

  const remove = () =>
    run(async () => {
      await api(apiPaths.booksBulk, { method: "POST", body: { action: "remove", ids: chosen.map((b) => b.id) } });
      setRemoving(false);
      toast(`Removed ${plural(chosen.length, "book")} from the library`);
    });

  return (
    <div className="select-bar" role="toolbar" aria-label="Selected books">
      <button type="button" className="icon-btn" aria-label="Stop selecting" onClick={onStop}>
        <CloseIcon />
      </button>
      <span className={chosen.length ? "select-count" : "select-count muted"}>{selectedLabel(chosen.length)}</span>
      {chosen.length < books.length ? (
        <button type="button" className="text-btn select-all" aria-label="Select all" onClick={onAll}>
          All
        </button>
      ) : null}
      <div className="select-actions">
        {isAdmin ? (
          <button type="button" className="text-btn wide-only" disabled={none || busy} onClick={() => setEditing(true)} aria-label="Edit">
            <PencilIcon />
            <span>Edit…</span>
          </button>
        ) : null}
        <button type="button" className="text-btn" disabled={none || busy} onClick={() => void markFinished()} aria-label={allFinished ? "Mark as not finished" : "Mark as finished"}>
          <CheckIcon />
          <span>{allFinished ? "Mark as not finished" : "Mark as finished"}</span>
        </button>
        <button type="button" className="text-btn wide-only" disabled={none || busy} onClick={() => void hide()} aria-label="Hide">
          <EyeOffIcon />
          <span>Hide</span>
        </button>
        {isAdmin ? (
          <button type="button" className="text-btn danger wide-only" disabled={none || busy} onClick={() => setRemoving(true)} aria-label="Remove">
            <TrashIcon />
            <span>Remove…</span>
          </button>
        ) : null}
        {/* A phone has no room for every action: Hide, Edit and Remove go under More, as in the app. */}
        <button type="button" className="text-btn phone-only" disabled={none || busy} onClick={() => setMore(true)} aria-label="More">
          <MoreIcon />
        </button>
      </div>
      <Sheet open={more} onClose={() => setMore(false)} title={selectedLabel(chosen.length)}>
        <SheetItem
          onClick={() => {
            setMore(false);
            void hide();
          }}
        >
          Hide
        </SheetItem>
        {isAdmin ? (
          <>
            <SheetItem
              onClick={() => {
                setMore(false);
                setEditing(true);
              }}
            >
              Edit…
            </SheetItem>
            <SheetItem
              danger
              onClick={() => {
                setMore(false);
                setRemoving(true);
              }}
            >
              Remove from library…
            </SheetItem>
          </>
        ) : null}
      </Sheet>
      {isAdmin && editing ? (
        <BulkEditSheet
          books={chosen}
          all={books}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onStop();
            router.refresh();
          }}
        />
      ) : null}
      {isAdmin ? (
        <RemoveBooksSheet open={removing} books={chosen} busy={busy} onConfirm={() => void remove()} onClose={() => setRemoving(false)} />
      ) : null}
    </div>
  );
}

/** Up to three covers, stacked, for a confirm about these books. */
export function CoverStack({ books }: { books: BookSummary[] }) {
  return (
    <>
      {books.slice(0, 3).map((b) => (
        <Cover key={b.id} src={b.coverHash ? apiPaths.coverUrl(b.id, b.coverHash, 200) : null} color={b.coverColor} title={b.title} />
      ))}
    </>
  );
}

/** Remove from library's confirm, for one book or several. */
export function RemoveBooksSheet({
  open,
  books,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  books: BookSummary[];
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const c = removeConfirm(books.length, "book", books.length === 1 ? books[0]!.title : undefined);
  return (
    <ConfirmSheet open={open} title={c.title} message={c.message} confirmLabel={c.action} busy={busy} art={<CoverStack books={books} />} onConfirm={onConfirm} onClose={onClose} />
  );
}

/** Edit on several books: only the fields books share. A field they differ on shows Mixed until typed in. */
function BulkEditSheet({ books, all, onClose, onSaved }: { books: BookSummary[]; all: BookSummary[]; onClose: () => void; onSaved: () => void }) {
  const start = useMemo(() => bulkStart(books), [books]);
  const [form, setForm] = useState<BulkEditForm>(() => bulkForm(start));
  const [busy, setBusy] = useState(false);
  const changes = bulkChanges(start, form);
  const count = Object.keys(changes).length;
  // The library's series, for the Series field's suggestions.
  const known = useMemo<KnownSeries[]>(() => {
    const counts = new Map<string, number>();
    for (const b of all) if (b.series) counts.set(b.series, (counts.get(b.series) ?? 0) + 1);
    return [...counts].map(([name, n]) => ({ name, books: n })).sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);

  const save = async () => {
    setBusy(true);
    try {
      await api(apiPaths.booksBulk, { method: "POST", body: { action: "edit", ids: books.map((b) => b.id), fields: changes } });
      toast(`Saved ${plural(books.length, "book")}`);
      onSaved();
    } catch (err) {
      toast.error(errorText(err));
      setBusy(false);
    }
  };

  const field = (f: BulkEditField, label: string) => {
    const id = `bulk-${f}`;
    const changed = f in changes;
    const set = (v: string) => setForm({ ...form, [f]: v });
    const placeholder = start[f] === null ? MIXED : f === "series" ? "None" : undefined;
    return (
      <div key={f} className="edit-field">
        <div className="edit-label">
          <label htmlFor={id}>{label}</label>
          {changed ? (
            <>
              <span className="edited-tag">
                <span className="edited-dot" aria-hidden="true" />
                Edited
              </span>
              <button type="button" className="link-btn" onClick={() => set(bulkForm(start)[f])}>
                Undo
              </button>
            </>
          ) : null}
        </div>
        {f === "series" ? (
          <SeriesInput id={id} value={form.series} placeholder={placeholder} known={known} onChange={set} />
        ) : (
          <input id={id} className="input" value={form[f]} placeholder={placeholder} onChange={(e) => set(e.target.value)} />
        )}
      </div>
    );
  };

  return (
    <Sheet open onClose={onClose} title={`Edit ${plural(books.length, "book")}`} className="bulk-edit" art={<div className="confirm-art"><CoverStack books={books} /></div>}>
      <div className="form">{BULK_EDIT_FIELDS.map((f) => field(f.id, f.label))}</div>
      <button type="button" className="btn btn-big btn-primary" disabled={busy || count === 0} onClick={() => void save()}>
        {busy ? "Saving…" : saveLabel(count)}
      </button>
    </Sheet>
  );
}

/** A card's pick disc while selecting, where the finished check goes. */
export function PickDisc({ on }: { on: boolean }) {
  return (
    <span className={`card-pick ${on ? "on" : ""}`} aria-hidden="true">
      {on ? <CheckIcon size={14} /> : null}
    </span>
  );
}
