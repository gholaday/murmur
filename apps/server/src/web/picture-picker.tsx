"use client";

/* eslint-disable @next/next/no-img-element -- suggested pictures are remote thumbnails */
import { useRef, useState } from "react";
import { CheckIcon, LinkIcon, PlusIcon } from "./icons";

export interface PictureSuggestion {
  key: string;
  src: string;
  /** Where it's from, under it: "Audible", "Google Books". */
  label?: string;
}

/**
 * An edit sheet's picture tab, the same for a book's cover and a movie's or show's poster and
 * background: the current picture with where it's from and a way back to the default, then
 * "Choose another" (Upload first, then suggestions), a link field, and one full-width
 * "Use this picture" once one is picked. Nothing applies on a tap.
 */
export function PicturePicker({
  shape,
  current,
  source,
  reset,
  suggestions,
  emptyText,
  busy,
  onUpload,
  onLink,
  onPick,
}: {
  shape: "square" | "poster" | "still";
  /** The current picture, as a Cover. */
  current: React.ReactNode;
  /** Where it's from: "Custom cover", "From the files". */
  source: string;
  /** Going back to the default picture, when there's one to go back to. */
  reset?: { label: string; onClick: () => void };
  /** null while they load; omitted when there are none to look for. */
  suggestions?: PictureSuggestion[] | null;
  emptyText?: string;
  busy: boolean;
  onUpload: (file: File) => Promise<boolean>;
  onLink: (url: string) => Promise<boolean>;
  onPick: (key: string) => Promise<boolean>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <div className={`pic-tab ${shape}`}>
      <div className="pic-current">
        {current}
        <div className="pic-current-text">
          <span className="pic-current-title">Current</span>
          <span className="muted small">{source}</span>
          {reset ? (
            <button type="button" className="text-btn pic-reset" disabled={busy} onClick={reset.onClick}>
              {reset.label}
            </button>
          ) : null}
        </div>
      </div>

      <div className="pic-choose">
        <div className="eyebrow">Choose another</div>
        <div className="pic-grid">
          <button
            type="button"
            className={`pic-option pic-upload ${dragging ? "over" : ""}`}
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
              if (file) void onUpload(file);
            }}
          >
            <span className="pic-thumb">
              <PlusIcon size={28} />
              <span className="pic-drop-hint">or drop here</span>
            </span>
            <span className="pic-label strong">Upload</span>
          </button>
          {suggestions === null
            ? [0, 1, 2].map((i) => (
                <div key={i} className="pic-option" aria-hidden="true">
                  <span className="pic-thumb skel" />
                </div>
              ))
            : (suggestions ?? []).map((s) => {
                const on = picked === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    className={`pic-option ${on ? "on" : ""}`}
                    disabled={busy}
                    aria-pressed={on}
                    aria-label={s.label ? `Pick the ${s.label} picture` : "Pick this picture"}
                    onClick={() => setPicked(on ? null : s.key)}
                  >
                    <span className="pic-thumb">
                      <img src={s.src} alt="" loading="lazy" />
                      {on ? (
                        <span className="pic-check" aria-hidden="true">
                          <CheckIcon size={14} />
                        </span>
                      ) : null}
                    </span>
                    {s.label ? <span className="pic-label">{s.label}</span> : null}
                  </button>
                );
              })}
        </div>
        {suggestions && suggestions.length === 0 && emptyText ? <p className="muted small pic-empty">{emptyText}</p> : null}
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void onUpload(file);
          }}
        />
        <form
          className="pic-link"
          onSubmit={(e) => {
            e.preventDefault();
            const link = url.trim();
            if (link) void onLink(link).then((ok) => ok && setUrl(""));
          }}
        >
          <LinkIcon size={18} />
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste an image link" aria-label="Image link" disabled={busy} />
        </form>
      </div>

      {picked ? (
        <div className="pic-foot">
          <button type="button" className="btn btn-big btn-primary" disabled={busy} onClick={() => void onPick(picked).then((ok) => ok && setPicked(null))}>
            {busy ? "Saving…" : "Use this picture"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
