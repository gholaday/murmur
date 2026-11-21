"use client";

/* eslint-disable @next/next/no-img-element -- TMDB picture suggestions are remote */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "../toast";
import { apiPaths, changedFields, errorText, saveLabel, type WatchArtOption } from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";

import { useSheetDialog } from "../sheet";
import { PicturePicker } from "../picture-picker";
import { WatchMatchPanel } from "./match-sheet";

export type WatchEditTab = "details" | "poster" | "backdrop" | "match";

interface Editable {
  id: string;
  title: string;
  year: string | null;
  description: string | null;
  posterHash: string | null;
  backdropHash: string | null;
  color: string | null;
  tmdbId: number | null;
  chosenArt: { poster: boolean; backdrop: boolean };
}

/**
 * Edit for a movie or show, like a book's: its details, its pictures, and Match. What you save
 * here wins over the files and TMDB from then on.
 */
export function WatchEditDialog({
  kind,
  item,
  tab: startTab,
  canMatch,
  onClose,
  onChanged,
}: {
  /** Runs after each change, for an opener that holds its own copy of `item` (a card menu). */
  onChanged?: () => void;
  kind: "movie" | "show";
  item: Editable;
  tab: WatchEditTab;
  /** TMDB is set up, so Match and the picture suggestions work. */
  canMatch: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { dialogProps, drag, dismiss } = useSheetDialog({ onClose });
  const [tab, setTab] = useState(startTab);
  const saved = { title: item.title, year: item.year ?? "", description: item.description ?? "" };
  const [form, setForm] = useState(saved);
  const [busy, setBusy] = useState(false);
  const changes = changedFields(form, saved);
  const dirty = changes > 0;
  const base = apiPaths.watchItem(kind, item.id);

  const save = async () => {
    setBusy(true);
    // The form takes what was sent: a stray space saved away would otherwise still count as a change.
    const sent = { title: form.title.trim(), year: form.year.trim(), description: form.description.trim() };
    try {
      await api(base, { method: "PATCH", body: { title: sent.title, year: sent.year || null, description: sent.description || null } });
      setForm(sent);
      toast("Saved");
      router.refresh();
      onChanged?.();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ id: WatchEditTab; label: string }> = [
    { id: "details", label: "Details" },
    { id: "poster", label: "Poster" },
    { id: "backdrop", label: "Background" },
    ...(canMatch ? [{ id: "match" as const, label: "Match" }] : []),
  ];
  const artUrl = kind === "movie" ? apiPaths.movieArtUrl : apiPaths.showArtUrl;
  const field = (f: keyof typeof form, label: string, input: React.ReactNode, wide = false) => (
    <div className={`edit-field ${wide ? "wide" : ""}`}>
      <div className="edit-label">
        <label htmlFor={`watch-${f}`}>{label}</label>
        {form[f] !== saved[f] ? (
          <button type="button" className="link-btn" onClick={() => setForm({ ...form, [f]: saved[f] })}>
            Undo
          </button>
        ) : null}
      </div>
      {input}
    </div>
  );

  return (
    <dialog className="sheet wide" aria-label={kind === "movie" ? "Edit movie" : "Edit show"} {...dialogProps}>
      <div className="edit">
        <div className="sheet-grab" aria-hidden="true" {...drag} />
        <div className="edit-head" {...drag}>
          <Cover
            className="edit-thumb poster"
            src={item.posterHash ? artUrl(item.id, "poster", item.posterHash, "small") : null}
            color={item.color}
            title={item.title}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sheet-title" style={{ padding: 0 }}>
              {kind === "movie" ? "Edit movie" : "Edit show"}
            </div>
            <div className="muted small edit-sub">{[item.title, item.year].filter(Boolean).join(", ")}</div>
          </div>
        </div>

        <div className="subtabs edit-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" className="subtab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === "details" && dirty ? <span className="dirty-dot" aria-label="unsaved" /> : null}
            </button>
          ))}
        </div>

        <div className="edit-body">
          {tab === "details" ? (
            <div className="edit-grid">
              {field(
                "title",
                "Title",
                <input id="watch-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />,
                true,
              )}
              {field(
                "year",
                "Year",
                <input
                  id="watch-year"
                  className="input"
                  inputMode="numeric"
                  maxLength={4}
                  value={form.year}
                  onChange={(e) => setForm({ ...form, year: e.target.value })}
                />,
              )}
              {field(
                "description",
                "Description",
                <textarea
                  id="watch-description"
                  className="input"
                  rows={6}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />,
                true,
              )}
            </div>
          ) : tab === "poster" || tab === "backdrop" ? (
            <ArtworkTab key={tab} kind={kind} which={tab} item={item} base={base} canSuggest={canMatch && item.tmdbId !== null} onChanged={onChanged} />
          ) : (
            <WatchMatchPanel
              kind={kind}
              id={item.id}
              title={item.title}
              year={item.year}
              tmdbId={item.tmdbId}
              onMatched={(title) => {
                toast(`Matched to ${title}`);
                router.refresh();
                dismiss();
              }}
            />
          )}
        </div>

        {/* Save is for the details; pictures and Match have their own buttons. */}
        {tab === "details" ? (
          <div className="edit-foot">
            <button type="button" className="btn btn-primary" disabled={busy || !dirty || !form.title.trim()} onClick={() => void save()}>
              {busy ? "Saving…" : saveLabel(changes)}
            </button>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

/** The poster or the backdrop: choose an image, paste a link, or pick one of TMDB's. */
function ArtworkTab({
  kind,
  which,
  item,
  base,
  canSuggest,
  onChanged,
}: {
  kind: "movie" | "show";
  which: "poster" | "backdrop";
  item: Editable;
  base: string;
  canSuggest: boolean;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [options, setOptions] = useState<WatchArtOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const hash = which === "poster" ? item.posterHash : item.backdropHash;
  const artUrl = kind === "movie" ? apiPaths.movieArtUrl : apiPaths.showArtUrl;

  useEffect(() => {
    if (!canSuggest) return;
    let live = true;
    setOptions(null);
    api<WatchArtOption[]>(`${base}/${which}/options`)
      .then((o) => live && setOptions(o))
      .catch(() => live && setOptions([]));
    return () => {
      live = false;
    };
  }, [base, which, canSuggest]);

  const act = async (send: () => Promise<unknown>, done = which === "poster" ? "Poster changed" : "Background changed") => {
    setBusy(true);
    try {
      await send();
      toast(done);
      router.refresh();
      onChanged?.();
      return true;
    } catch (err) {
      toast.error(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const upload = (file: File) =>
    act(async () => {
      const body = new FormData();
      body.set("image", file);
      const res = await fetch(`${base}/${which}`, { method: "POST", body });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Upload failed (${res.status}).`);
    });

  return (
    <PicturePicker
      shape={which === "poster" ? "poster" : "still"}
      current={
        <Cover src={hash ? artUrl(item.id, which, hash, "large") : null} color={item.color} title={item.title} className={which === "poster" ? "poster" : "still"} />
      }
      source={item.chosenArt[which] ? "Your own picture" : hash ? "From TMDB" : "No picture yet"}
      reset={
        item.chosenArt[which]
          ? { label: "Use TMDB's picture", onClick: () => void act(() => api(`${base}/${which}`, { method: "DELETE" }), "Using TMDB's picture") }
          : undefined
      }
      suggestions={canSuggest ? (options === null ? null : options.map((o) => ({ key: o.tmdbPath, src: o.thumbUrl }))) : undefined}
      emptyText="TMDB has no other pictures for this."
      busy={busy}
      onUpload={upload}
      onLink={(link) => act(() => api(`${base}/${which}`, { method: "POST", body: { url: link } }))}
      onPick={(tmdbPath) => act(() => api(`${base}/${which}`, { method: "POST", body: { tmdbPath } }))}
    />
  );
}
