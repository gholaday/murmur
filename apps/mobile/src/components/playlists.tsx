import { memo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import { albumCover, duration, plural, type PlaylistDetail, playlistCoverTiles, type PlaylistSummary } from "@murmur/shared/client";
import { absolute, authHeaders } from "@/lib/api";
import { addToPlaylist, createPlaylist, usePlaylists } from "@/lib/data";
import { useTheme } from "@/theme";
import { Cover } from "./cover";
import { Sheet, SheetItem } from "./sheet";
import { toast } from "./toast";
import { Button, Field, Text } from "./ui";

// Each person's own playlists: the Music tab's Playlists, a playlist's page, and adding songs.

export const openPlaylist = (id: string) => router.push(`/playlist/${id}`);

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/**
 * The playlist's albums tiled into one square, each shown once (see playlistCoverTiles); one
 * album is its own cover, and none is the name on a tile.
 */
export function PlaylistCover({ playlist, size }: { playlist: PlaylistSummary; size?: number }) {
  const { covers, name } = playlist;
  if (covers.length < 2) {
    const first = covers[0];
    return <Cover path={first ? albumCover(first.albumId, first.coverHash, 600) : null} title={name} size={size} />;
  }
  return (
    <View style={{ width: size ?? "100%", aspectRatio: 1, borderRadius: 10, overflow: "hidden" }}>
      {playlistCoverTiles(covers).map(({ cover, x, y, w, h }) => {
        // A full-height half needs the larger image to stay sharp.
        const path = albumCover(cover.albumId, cover.coverHash, h === 1 ? 600 : undefined)!;
        return (
          <Image
            key={cover.albumId}
            source={{ uri: absolute(path), headers: authHeaders(), cacheKey: path }}
            cachePolicy="memory-disk"
            contentFit="cover"
            style={{ position: "absolute", left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
          />
        );
      })}
    </View>
  );
}

/** A playlist in the grid: its cover, name, and how many songs. */
export const PlaylistCard = memo(function PlaylistCard({ playlist, width }: { playlist: PlaylistSummary; width: number }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${playlist.name}, ${plural(playlist.trackCount, "song")}`}
      onPress={() => openPlaylist(playlist.id)}
      style={({ pressed }) => ({ width, gap: 8, opacity: pressed ? 0.75 : 1 })}
    >
      <PlaylistCover playlist={playlist} />
      <View style={{ gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14 }}>
          {playlist.name}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {plural(playlist.trackCount, "song")}
        </Text>
      </View>
    </Pressable>
  );
});

/** "13 songs" and "52m", for the pills on a playlist's page. */
export const playlistPills = (p: PlaylistSummary): string[] =>
  p.durationSec ? [plural(p.trackCount, "song"), duration(p.durationSec)] : [plural(p.trackCount, "song")];

/** A name field and a button, for a new playlist or a rename. */
function NameForm({ initial = "", action, busyLabel, onSubmit }: { initial?: string; action: string; busyLabel: string; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ok = name.trim().length > 0 && name.trim() !== initial.trim();
  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      await onSubmit(name.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 14, paddingHorizontal: 4, paddingBottom: 4 }}>
      <Field
        label="Playlist name"
        value={name}
        onChangeText={setName}
        placeholder="Road trip"
        autoFocus
        maxLength={200}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      <Button label={busy ? busyLabel : action} busy={busy} disabled={!ok} onPress={() => void submit()} />
    </View>
  );
}

/** Asks for a name: "New playlist" on the Music tab, "Rename" on a playlist's page. */
export function NamePlaylistSheet({
  open,
  onClose,
  title,
  initial,
  action,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  initial?: string;
  action: string;
  /** Throws to keep the sheet open; it shows the error itself. */
  onSubmit: (name: string) => Promise<void>;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {open ? (
        <NameForm
          initial={initial}
          action={action}
          busyLabel="Saving…"
          onSubmit={async (name) => {
            try {
              await onSubmit(name);
              onClose();
            } catch (err) {
              toast.error(errorText(err, "Couldn't save that."));
            }
          }}
        />
      ) : null}
    </Sheet>
  );
}

/** Pick one of your playlists to add songs to, or make a new one with them. */
export function AddToPlaylistSheet({ open, onClose, title, trackIds }: { open: boolean; onClose: () => void; title: string; trackIds: string[] }) {
  const t = useTheme();
  const lists = usePlaylists(open);
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Each time it opens, it starts at the list rather than the name field.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setNaming(false);
  }

  const done = (p: PlaylistDetail, verb: string) => {
    onClose();
    toast.show(`${verb} ${p.name}`, { action: { label: "Open", onPress: () => openPlaylist(p.id) } });
  };
  const add = async (p: PlaylistSummary) => {
    setBusy(true);
    try {
      done(await addToPlaylist(p.id, trackIds), "Added to");
    } catch (err) {
      toast.error(errorText(err, "Couldn't add that."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={`Add ${trackIds.length === 1 ? title : plural(trackIds.length, "song")} to a playlist`}>
      {naming ? (
        <NameForm
          action="Make playlist"
          busyLabel="Making…"
          onSubmit={async (name) => {
            try {
              done(await createPlaylist(name, trackIds), "Made");
            } catch (err) {
              toast.error(errorText(err, "Couldn't make that playlist."));
            }
          }}
        />
      ) : (
        <>
          <SheetItem label="New playlist…" onPress={() => setNaming(true)} />
          {lists.data ? (
            lists.data.map((p) => <SheetItem key={p.id} label={p.name} hint={plural(p.trackCount, "song")} disabled={busy} onPress={() => void add(p)} />)
          ) : lists.isError ? (
            <Text variant="small" style={{ color: t.danger, padding: 12 }}>
              {lists.error.message}
            </Text>
          ) : (
            <ActivityIndicator color={t.accent} style={{ paddingVertical: 16 }} />
          )}
        </>
      )}
    </Sheet>
  );
}
