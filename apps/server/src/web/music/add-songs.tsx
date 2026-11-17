"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { albumCover, apiPaths, errorText, type LikedMusicDto, type PlaylistDetail, songSub, type TrackDto } from "@murmur/shared/client";
import { api } from "../api";
import { Cover } from "../cover";
import { AddCircleIcon } from "../icons";
import { BackRow, Chip, Chips, EmptyState, SearchBox } from "../ui";

type Source = "recent" | "liked";
const SOURCES: { id: Source; label: string }[] = [
  { id: "recent", label: "Recently played" },
  { id: "liked", label: "Liked" },
];

const load = async (source: Source, q: string): Promise<TrackDto[]> => {
  if (q) return api<TrackDto[]>(apiPaths.tracks(q));
  if (source === "recent") return api<TrackDto[]>(apiPaths.trackPlays);
  return (await api<LikedMusicDto>(apiPaths.musicLiked)).tracks;
};

/**
 * Find songs and add each to the playlist with one tap; tapping its check takes it back out.
 * Typing searches all the music; with nothing typed, Recently played or Liked.
 */
export function AddSongsView({ playlist: initial }: { playlist: PlaylistDetail }) {
  const [playlist, setPlaylist] = useState(initial);
  // The latest songs for an Undo that runs after more were added or removed.
  const latest = useRef(initial);
  const [source, setSource] = useState<Source>("recent");
  const [query, setQuery] = useState("");
  const [songs, setSongs] = useState<TrackDto[] | null>(null);
  const q = query.trim();
  const inList = new Set(playlist.tracks.map((t) => t.id));

  useEffect(() => {
    let live = true;
    // Typing waits a moment before searching; switching lists loads at once.
    const timer = setTimeout(
      () => {
        load(source, q).then(
          (list) => live && setSongs(list),
          (err: unknown) => {
            if (!live) return;
            toast.error(errorText(err));
            setSongs([]);
          },
        );
      },
      q ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [source, q]);

  const shown = songs ?? [];

  const setIn = async (track: TrackDto, on: boolean, undoable = true) => {
    try {
      const next = on
        ? await api<PlaylistDetail>(apiPaths.playlistTracks(playlist.id), { method: "POST", body: { trackIds: [track.id] } })
        : await api<PlaylistDetail>(apiPaths.playlist(playlist.id), {
            method: "PATCH",
            body: { trackIds: latest.current.tracks.filter((t) => t.id !== track.id).map((t) => t.id) },
          });
      latest.current = next;
      setPlaylist(next);
      if (undoable) {
        toast(on ? `Added to ${playlist.name}` : `Removed from ${playlist.name}`, {
          action: { label: "Undo", onClick: () => void setIn(track, !on, false) },
        });
      }
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <>
      <BackRow fallback={`/music/playlist/${playlist.id}`} />
      <div className="page-head">
        <h1 className="page-title" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Add to {playlist.name}
        </h1>
      </div>
      <SearchBox value={query} onChange={setQuery} placeholder="Search songs, albums or artists" label="Search songs" />
      {q ? null : (
        <Chips kind="tabs" label="Songs to add">
          {SOURCES.map((s) => (
            <Chip key={s.id} selected={source === s.id} onClick={() => setSource(s.id)}>
              {s.label}
            </Chip>
          ))}
        </Chips>
      )}

      <section className="section">
        {songs === null ? null : shown.length === 0 ? (
          <EmptyState>
            {q ? `No songs match "${q}".` : source === "recent" ? "Songs you play show up here." : "Songs you like show up here."}
          </EmptyState>
        ) : (
          <div className="list">
            {shown.map((t) => {
              const added = inList.has(t.id);
              return (
                <div key={t.id} className="list-row">
                  <span className="add-song-info">
                    <Cover src={albumCover(t.albumId, t.coverHash)} color={null} title={t.album} className="thumb" />
                    <span className="list-row-main">
                      <span className="list-row-title">{t.title}</span>
                      <span className="list-row-sub">{songSub(t)}</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    className="icon-btn add-song"
                    aria-pressed={added}
                    aria-label={added ? `Remove ${t.title} from ${playlist.name}` : `Add ${t.title} to ${playlist.name}`}
                    onClick={() => void setIn(t, !added)}
                  >
                    <AddCircleIcon size={26} added={added} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
