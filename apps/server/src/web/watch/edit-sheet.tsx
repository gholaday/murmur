"use client";

/* eslint-disable @next/next/no-img-element -- TMDB picture suggestions are remote */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiPaths, errorText, type WatchArtOption } from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { CloseIcon } from "../icons";
import { useBackdropClose } from "../sheet";
import { Chip, Chips } from "../ui";
import { WatchMatchPanel } from "./match-sheet";

export type WatchEditTab = "details" | "artwork" | "match";

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
}: {
  kind: "movie" | "show";
  item: Editable;
  tab: WatchEditTab;
  /** TMDB is set up, so Match and the picture suggestions work. */
  canMatch: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const backdropClose = useBackdropClose(onClose);
  const [tab, setTab] = useState(startTab);
  const saved = { title: item.title, year: item.year ?? "", description: item.description ?? "" };
  const [form, setForm] = useState(saved);
  const [busy, setBusy] = useState(false);
  const dirty = form.title !== saved.title || form.year !== saved.year || form.description !== saved.description;
  const base = `/api/watch/${kind === "movie" ? "movies" : "shows"}/${item.id}`;

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await api(base, {
        method: "PATCH",
        body: { title: form.title.trim(), year: form.year.trim() || null, description: form.description.trim() || null },
      });
      toast("Saved");
      router.refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ id: WatchEditTab; label: string }> = [
    { id: "details", label: "Details" },
    { id: "artwork", label: "Artwork" },
    ...(canMatch ? [{ id: "match" as const, label: "Match" }] : []),
  ];

  return (
    <dialog ref={ref} className="sheet wide" aria-label="Edit" onClose={onClose} {...backdropClose}>
      <div className="edit">
        <div className="edit-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sheet-title" style={{ padding: 0 }}>
              Edit
            </div>
            <div className="muted small edit-sub">{item.title}</div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
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
              <div className="edit-field wide">
                <label className="edit-label" htmlFor="watch-title">
                  Title
                </label>
                <input id="watch-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="edit-field">
                <label className="edit-label" htmlFor="watch-year">
                  Year
                </label>
                <input
                  id="watch-year"
                  className="input"
                  inputMode="numeric"
                  maxLength={4}
                  value={form.year}
                  onChange={(e) => setForm({ ...form, year: e.target.value })}
                />
              </div>
              <div className="edit-field wide">
                <label className="edit-label" htmlFor="watch-description">
                  Description
                </label>
                <textarea
                  id="watch-description"
                  className="input"
                  rows={6}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
            </div>
          ) : tab === "artwork" ? (
            <ArtworkTab kind={kind} item={item} base={base} canSuggest={canMatch && item.tmdbId !== null} />
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
                onClose();
              }}
            />
          )}
        </div>

        {tab === "details" ? (
          <div className="edit-foot">
            {dirty ? (
              <span className="muted small" style={{ flex: 1 }}>
                Unsaved changes
              </span>
            ) : null}
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || !dirty || !form.title.trim()} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

/** The poster or the backdrop: choose an image, paste a link, or pick one of TMDB's. */
function ArtworkTab({ kind, item, base, canSuggest }: { kind: "movie" | "show"; item: Editable; base: string; canSuggest: boolean }) {
  const router = useRouter();
  const [which, setWhich] = useState<"poster" | "backdrop">("poster");
  const [options, setOptions] = useState<WatchArtOption[] | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
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
    } catch (err) {
      toast.error(errorText(err));
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
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Chips kind="tabs" label="Picture">
        <Chip selected={which === "poster"} onClick={() => setWhich("poster")}>
          Poster
        </Chip>
        <Chip selected={which === "backdrop"} onClick={() => setWhich("backdrop")}>
          Background
        </Chip>
      </Chips>
      <div style={{ width: which === "poster" ? 140 : 320, maxWidth: "100%" }}>
        <Cover
          src={hash ? artUrl(item.id, which, hash, "large") : null}
          color={item.color}
          title={item.title}
          className={which === "poster" ? "poster" : "still"}
        />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
          Choose an image
        </button>
        {item.chosenArt[which] ? (
          <button type="button" className="btn" disabled={busy} onClick={() => void act(() => api(`${base}/${which}`, { method: "DELETE" }), "Removed")}>
            Remove
          </button>
        ) : null}
      </div>
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
          const link = url.trim();
          if (link) void act(() => api(`${base}/${which}`, { method: "POST", body: { url: link } })).then(() => setUrl(""));
        }}
      >
        <input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Or paste an image link" aria-label="Image link" />
        <button type="submit" className="btn" disabled={busy || !url.trim()}>
          Use link
        </button>
      </form>
      {canSuggest ? (
        <>
          <div className="edit-label">Suggestions</div>
          {options === null ? (
            <div className={`art-suggest ${which}`} aria-busy="true" aria-label="Looking for pictures">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skel" />
              ))}
            </div>
          ) : options.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              TMDB has no other pictures for this.
            </p>
          ) : (
            <div className={`art-suggest ${which}`}>
              {options.map((o) => (
                <button
                  key={o.tmdbPath}
                  type="button"
                  disabled={busy}
                  aria-label="Use this picture"
                  onClick={() => void act(() => api(`${base}/${which}`, { method: "POST", body: { tmdbPath: o.tmdbPath } }))}
                >
                  <img src={o.thumbUrl} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
