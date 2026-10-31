"use client";

import { useState } from "react";
import { type BookmarkDto, BOOKMARK_NOTE_MAX, BOOKMARK_NUDGE_SEC, clock } from "@murmur/shared/client";
import { deleteBookmark, updateBookmark } from "./bookmarks";
import { PencilIcon, PlayIcon } from "./icons";
import { ConfirmSheet, Sheet } from "./sheet";

/** The bookmark rows, the same on books and podcasts: the time, then a chapter and a note if there are any. */
export function BookmarkRows({ bookmarks, onJump }: { bookmarks: BookmarkDto[]; onJump: (b: BookmarkDto) => void }) {
  const [editing, setEditing] = useState<BookmarkDto | null>(null);
  return (
    <>
      <div className="bookmarks">
        {bookmarks.map((b) => (
          <div key={b.id} className="bookmark">
            <button type="button" className="bookmark-go" aria-label={`Go to ${clock(b.positionSec)}`} onClick={() => onJump(b)}>
              <span className="bookmark-play">
                <PlayIcon size={16} />
              </span>
              <span className="bookmark-main">
                <span className="bookmark-time">{clock(b.positionSec)}</span>
                {b.chapter ? <span className="bookmark-chapter">{b.chapter}</span> : null}
                {b.note ? <span className="bookmark-note">{b.note}</span> : null}
              </span>
            </button>
            <button type="button" className="icon-btn dim" aria-label={`Edit bookmark at ${clock(b.positionSec)}`} onClick={() => setEditing(b)}>
              <PencilIcon size={20} />
            </button>
          </div>
        ))}
      </div>
      <BookmarkNoteSheet bookmark={editing} onClose={() => setEditing(null)} />
    </>
  );
}

/** Adds or edits a bookmark's note, and moves it a little if it landed in the wrong spot. */
export function BookmarkNoteSheet({ bookmark, onClose }: { bookmark: BookmarkDto | null; onClose: () => void }) {
  return (
    <Sheet open={bookmark !== null} onClose={onClose} title={bookmark?.note ? "Edit note" : "Add a note"} sub={bookmark?.chapter}>
      {bookmark ? <NoteForm key={bookmark.id} bookmark={bookmark} onClose={onClose} /> : null}
    </Sheet>
  );
}

function NoteForm({ bookmark, onClose }: { bookmark: BookmarkDto; onClose: () => void }) {
  const [position, setPosition] = useState(bookmark.positionSec);
  const [note, setNote] = useState(bookmark.note ?? "");
  const [deleting, setDeleting] = useState(false);
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        updateBookmark(bookmark, { positionSec: position, note: note.trim() || null, chapter: bookmark.chapter });
        onClose();
      }}
    >
      <div className="bookmark-nudge">
        <button type="button" className="btn" aria-label={`Move back ${BOOKMARK_NUDGE_SEC} seconds`} onClick={() => setPosition((p) => Math.max(0, p - BOOKMARK_NUDGE_SEC))}>
          −{BOOKMARK_NUDGE_SEC}s
        </button>
        <span className="bookmark-nudge-time">{clock(position)}</span>
        <button type="button" className="btn" aria-label={`Move forward ${BOOKMARK_NUDGE_SEC} seconds`} onClick={() => setPosition((p) => p + BOOKMARK_NUDGE_SEC)}>
          +{BOOKMARK_NUDGE_SEC}s
        </button>
      </div>
      <textarea className="input" rows={3} maxLength={BOOKMARK_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" aria-label="Note" />
      <button type="submit" className="btn btn-primary btn-big">
        Save
      </button>
      <button type="button" className="btn btn-plain-danger" onClick={() => setDeleting(true)}>
        Delete bookmark
      </button>
      <ConfirmSheet
        open={deleting}
        title="Delete this bookmark?"
        message={`It goes for good, along with its note.`}
        confirmLabel="Delete"
        onConfirm={() => {
          deleteBookmark(bookmark);
          setDeleting(false);
          onClose();
        }}
        onClose={() => setDeleting(false)}
      />
    </form>
  );
}
