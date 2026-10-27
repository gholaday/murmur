"use client";

/* eslint-disable @next/next/no-img-element -- source cover thumbnails are remote */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ALBUM_PROVIDER_NAME,
  type AlbumCandidate,
  type AlbumSummary,
  albumCover,
  type AlbumMatchField,
  type AlbumMatchPreview,
  type AlbumMatchSearch,
  type AlbumMatchValues,
  type ArtistDetail,
  type ArtistPhotoOption,
  errorText,
  plural,
} from "@murmur/shared/client";
import { api } from "../api";
import { scoreClass } from "../book/match-dialog";
import { Cover } from "../cover";
import { BackIcon, CloseIcon } from "../icons";
import { useBackdropClose } from "../sheet";

// Album Match, built like books': the same dialog, search, results, side-by-side review and
// classes, with an album's fields.

const keyOf = (c: Pick<AlbumCandidate, "provider" | "providerId">) => `${c.provider}:${c.providerId}`;

export const ALBUM_FIELDS: Array<{ field: AlbumMatchField; label: string; show: (v: AlbumMatchValues) => React.ReactNode }> = [
  { field: "cover", label: "Cover", show: (v) => (v.coverUrl ? <img src={v.coverUrl} alt="" /> : <span className="muted">None</span>) },
  { field: "title", label: "Title", show: (v) => v.title },
  { field: "year", label: "Year", show: (v) => v.year },
  { field: "genre", label: "Genre", show: (v) => v.genre },
  {
    field: "tracks",
    label: "Songs",
    show: (v) =>
      v.songs.length ? (
        <ol className="match-songs">
          {v.songs.map((s, i) => (
            <li key={i}>
              <span className="muted">{s.number ?? "–"}</span>
              {s.title}
            </li>
          ))}
        </ol>
      ) : null,
  },
];

const songsText = (v: AlbumMatchValues) => v.songs.map((s) => `${s.number}:${s.title.trim()}`).join("\n");

/** The fields last applied from an album match, ticked again at the next review. Kept in this browser. */
const LAST_FIELDS_KEY = "murmur.albumMatchFields";

export function lastAlbumFields(): AlbumMatchField[] | null {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_FIELDS_KEY) ?? "null") as unknown;
    return Array.isArray(raw) ? raw.filter((f): f is AlbumMatchField => ALBUM_FIELDS.some((x) => x.field === f)) : null;
  } catch {
    return null;
  }
}

function saveLastFields(fields: AlbumMatchField[]) {
  try {
    localStorage.setItem(LAST_FIELDS_KEY, JSON.stringify(fields));
  } catch {
    // private mode: the next review starts from the recommended fields
  }
}

const norm = (s: string | null) => (s ?? "").trim();

/** The album already has exactly the result's value. Covers can't be told apart from here. */
function isSame(preview: AlbumMatchPreview, field: AlbumMatchField): boolean {
  if (field === "cover") return false;
  if (field === "tracks") return preview.proposed.songs.length > 0 && songsText(preview.current) === songsText(preview.proposed);
  return !!preview.proposed[field] && norm(preview.current[field]) === norm(preview.proposed[field]);
}

function canApply(preview: AlbumMatchPreview, field: AlbumMatchField): boolean {
  const entry = ALBUM_FIELDS.find((f) => f.field === field);
  const blocked = field === "tracks" && !!preview.songsNote;
  return !!entry?.show(preview.proposed) && !blocked && !isSame(preview, field);
}

/** The admin's Match dialog for one album, like the Match tab of a book's edit dialog. */
export function AlbumMatchDialog({ album, onClose, onApplied }: { album: AlbumSummary; onClose: () => void; onApplied: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropClose = useBackdropClose(onClose);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  return (
    <dialog ref={ref} className="sheet wide" aria-label="Match album" onClose={onClose} {...backdropClose}>
      <div className="edit">
        <div className="edit-head">
          <Cover className="edit-thumb" src={albumCover(album.id, album.coverHash)} color={album.coverColor} title={album.title} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sheet-title" style={{ padding: 0 }}>
              Match album
            </div>
            <div className="muted small edit-sub">{`${album.title}, ${album.artist}`}</div>
            <div className="muted small edit-sub">Your files: {plural(album.trackCount, "song")}</div>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="edit-body">
          <AlbumMatchPanel albumId={album.id} onApplied={onApplied} />
        </div>
      </div>
    </dialog>
  );
}

/** Search, pick a result, review and apply. Starts searching as soon as it's shown. */
function AlbumMatchPanel({ albumId, onApplied }: { albumId: string; onApplied: () => void }) {
  const [result, setResult] = useState<AlbumMatchSearch | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<AlbumMatchPreview | null>(null);
  const [chosen, setChosen] = useState<Set<AlbumMatchField>>(new Set());
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [busy, setBusy] = useState(false);

  const search = useCallback(
    async (custom?: { title: string; artist: string }) => {
      setBusy(true);
      setPreview(null);
      try {
        const qs = custom ? `?${new URLSearchParams(custom)}` : "";
        const r = await api<AlbumMatchSearch>(`/api/music/albums/${albumId}/match${qs}`);
        setResult(r);
        setSelected(r.suggested);
        for (const e of r.errors) toast.error(e, { id: e });
        if (!custom) {
          setTitle(r.query.title);
          setArtist(r.query.artist);
        }
      } catch (err) {
        toast.error(errorText(err));
      } finally {
        setBusy(false);
      }
    },
    [albumId],
  );

  useEffect(() => {
    void search();
  }, [search]);

  const review = async () => {
    const c = result?.candidates.find((x) => keyOf(x) === selected);
    if (!c) return;
    setBusy(true);
    try {
      const p = await api<AlbumMatchPreview>(
        `/api/music/albums/${albumId}/match/preview?${new URLSearchParams({ provider: c.provider, providerId: c.providerId })}`,
      );
      setPreview(p);
      setChosen(new Set(lastAlbumFields() ?? p.recommended));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const fields = preview ? [...chosen].filter((f) => canApply(preview, f)) : [];

  const apply = async () => {
    if (!preview || fields.length === 0) return;
    setBusy(true);
    try {
      await api(`/api/music/albums/${albumId}/match`, {
        method: "POST",
        body: { provider: preview.provider, providerId: preview.providerId, fields },
      });
      saveLastFields([...chosen]);
      onApplied();
    } catch (err) {
      toast.error(errorText(err));
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
                  <th>{ALBUM_PROVIDER_NAME[preview.provider]}</th>
                </tr>
              </thead>
              <tbody>
                {ALBUM_FIELDS.map(({ field, label, show }) => {
                  const proposed = show(preview.proposed);
                  const disabled = !canApply(preview, field);
                  const same = isSame(preview, field);
                  return (
                    <tr key={field} className={same ? "same" : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Use ${label.toLowerCase()} from ${ALBUM_PROVIDER_NAME[preview.provider]}`}
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
                        {field === "tracks" && preview.songsNote ? <div className="small error">{preview.songsNote}</div> : null}
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
              void search({ title, artist });
            }}
          >
            <div className="form-row" style={{ flexWrap: "wrap" }}>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Album" aria-label="Search album" />
              <input className="input" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist" aria-label="Search artist" />
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
                        {c.thumbUrl ? <img src={c.thumbUrl} alt="" loading="lazy" /> : <div className="cover" />}
                        <span className="candidate-main">
                          <span style={{ fontWeight: 700 }}>{c.title}</span>
                          <span className="small">{c.artist}</span>
                          <span className="candidate-tags">
                            {[c.trackCount ? plural(c.trackCount, "song") : null, c.year, c.genre, ALBUM_PROVIDER_NAME[c.provider]]
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

/** Pick an artist's photo from Deezer's, or use the newest album's cover. */
export function ArtistPhotoDialog({ artist, onClose, onChanged }: { artist: ArtistDetail; onClose: () => void; onChanged: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropClose = useBackdropClose(onClose);
  const [options, setOptions] = useState<ArtistPhotoOption[] | null>(null);
  const [query, setQuery] = useState(artist.name);
  const [busy, setBusy] = useState(false);

  const search = useCallback(
    async (q?: string) => {
      setBusy(true);
      try {
        setOptions(await api<ArtistPhotoOption[]>(`/api/music/artists/${artist.id}/photo/options${q ? `?${new URLSearchParams({ q })}` : ""}`));
      } catch (err) {
        toast.error(errorText(err));
        setOptions([]);
      } finally {
        setBusy(false);
      }
    },
    [artist.id],
  );

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    void search();
  }, [search]);

  const pick = async (providerId: string | null) => {
    setBusy(true);
    try {
      await api(`/api/music/artists/${artist.id}/photo`, { method: "PUT", body: { providerId } });
      toast(providerId ? "Photo changed" : "Using the album cover");
      onChanged();
      onClose();
    } catch (err) {
      toast.error(errorText(err));
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="sheet wide" aria-label="Change photo" onClose={onClose} {...backdropClose}>
      <div className="edit">
        <div className="edit-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sheet-title" style={{ padding: 0 }}>
              Change photo
            </div>
            <div className="muted small edit-sub">{artist.name}</div>
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
                void search(query.trim());
              }}
            >
              <div className="form-row">
                <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Artist" aria-label="Search artist" />
                <button type="submit" className="btn btn-primary" disabled={busy || !query.trim()}>
                  Search
                </button>
              </div>
            </form>
            {options === null ? (
              <div className="loading-center" aria-busy="true" aria-label="Searching">
                <div className="spinner" />
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {options.map((o) => (
                  <button key={o.providerId} type="button" className="candidate" aria-pressed={o.current} disabled={busy} onClick={() => void pick(o.providerId)}>
                    <img src={o.thumbUrl} alt="" loading="lazy" className="round" />
                    <span className="candidate-main">
                      <span style={{ fontWeight: 700 }}>{o.name}</span>
                      <span className="candidate-tags">
                        <span>{plural(o.fans, "fan")}</span>
                        {o.current ? <span>Now</span> : null}
                      </span>
                    </span>
                  </button>
                ))}
                {options.length === 0 ? <p className="muted">No photos found.</p> : null}
                <button type="button" className="btn" disabled={busy} onClick={() => void pick(null)}>
                  Use the album cover
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
