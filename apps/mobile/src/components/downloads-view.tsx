import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { albumCover, apiPaths, episodeLabel, plural } from "@murmur/shared/client";
import { downloadingText, formatBytes, removeAllDownloads, removeDownload, useDownload, useDownloads, type Download } from "@/lib/downloads";
import { openMovie, openTvShow, openVideoPlayer } from "@/lib/watch";
import { isCurrent, isPlayingFrom, playMusic, playRef, usePlayerSelect } from "@/player/engine";
import { fonts, useTheme } from "@/theme";
import { Cover } from "./cover";
import { CloseIcon, PlayIcon } from "./icons";
import { PAD } from "./library";
import { ListMeta } from "./listening";
import { BottomMiniPlayer } from "./mini-player";
import { Empty, NestedHead, SectionTitle, useBottomPad, useTopInset } from "./page";
import { ConfirmSheet, RemoveDownloadSheet } from "./sheet";
import { IconButton, Text } from "./ui";

/** Downloads, opened from You: everything saved on this phone, with sizes and a remove action. */
export function DownloadsView() {
  const t = useTheme();
  const top = useTopInset();
  const bottom = useBottomPad();
  const all = Object.values(useDownloads()).sort((a, b) => b.savedAt - a.savedAt);
  const books = all.filter((d) => d.type === "book");
  const episodes = all.filter((d) => d.type === "podcast");
  const music = all.filter((d) => d.type === "album" || d.type === "track");
  const movies = all.filter((d) => d.type === "movie");
  // TV episodes in a section per show, in watching order.
  const shows = new Map<string, { title: string; list: (Download & { type: "show" })[] }>();
  for (const d of all) {
    if (d.type !== "show") continue;
    const group = shows.get(d.show.id) ?? { title: d.show.title, list: [] };
    group.list.push(d);
    shows.set(d.show.id, group);
  }
  for (const g of shows.values()) g.list.sort((a, b) => a.episode.season - b.episode.season || a.episode.episode - b.episode.episode);
  const bytes = all.reduce((sum, d) => sum + d.bytes, 0);
  const [removing, setRemoving] = useState<Download | null>(null);
  const [removingAll, setRemovingAll] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: bottom }}>
        <NestedHead title="Downloads" />
        {all.length ? (
          <ListMeta
            text={bytes > 0 ? `${formatBytes(bytes)} on this phone` : ""}
            action={
              <Pressable accessibilityRole="button" onPress={() => setRemovingAll(true)} hitSlop={10} style={{ paddingVertical: 10 }}>
                <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: t.danger }}>Remove all</Text>
              </Pressable>
            }
          />
        ) : (
          <Empty title="Nothing downloaded" />
        )}
        {books.length ? (
          <>
            <SectionTitle title="Books" count={books.length} />
            {books.map((d) => (
              <DownloadRow key={d.id} download={d} onRemove={() => onRemove(d)} />
            ))}
          </>
        ) : null}
        {episodes.length ? (
          <>
            <SectionTitle title="Episodes" count={episodes.length} />
            {episodes.map((d) => (
              <DownloadRow key={d.id} download={d} onRemove={() => onRemove(d)} />
            ))}
          </>
        ) : null}
        {music.length ? (
          <>
            <SectionTitle title="Music" count={music.length} />
            {music.map((d) => (
              <DownloadRow key={`${d.type}:${d.id}`} download={d} onRemove={() => onRemove(d)} />
            ))}
          </>
        ) : null}
        {movies.length ? (
          <>
            <SectionTitle title="Movies" count={movies.length} />
            {movies.map((d) => (
              <DownloadRow key={d.id} download={d} onRemove={() => onRemove(d)} />
            ))}
          </>
        ) : null}
        {[...shows].map(([showId, g]) => (
          <View key={showId}>
            <SectionTitle title={g.title} count={g.list.length} />
            {g.list.map((d) => (
              <DownloadRow key={d.id} download={d} onRemove={() => onRemove(d)} />
            ))}
          </View>
        ))}
      </ScrollView>
      <BottomMiniPlayer />

      <RemoveDownloadSheet
        open={removing !== null}
        title={removing ? titleOf(removing) : ""}
        onConfirm={() => removing && removeDownload(removing.type, removing.id)}
        onClose={() => setRemoving(null)}
      />
      <ConfirmSheet
        open={removingAll}
        title="Remove all downloads?"
        message="Everything downloaded is deleted from this phone. It all stays on the server, so you can download it again."
        confirmLabel="Remove all"
        onConfirm={removeAllDownloads}
        onClose={() => setRemovingAll(false)}
      />
    </View>
  );

  // A finished download is asked about first; cancelling one in progress or clearing a failed one isn't.
  function onRemove(d: Download) {
    if (d.status === "done") setRemoving(d);
    else removeDownload(d.type, d.id);
  }
}

function titleOf(d: Download) {
  switch (d.type) {
    case "book":
      return d.book.title;
    case "podcast":
      return d.episode.title;
    case "album":
      return d.album.title;
    case "track":
      return d.track.title;
    case "movie":
      return d.movie.title;
    case "show":
      return d.episode.title;
  }
}

/** Cover, subtitle, what it is, where it opens and how it plays, for each kind of download. */
function describe(d: Download) {
  switch (d.type) {
    case "book":
      return {
        cover: d.book.coverHash ? apiPaths.coverUrl(d.book.id, d.book.coverHash, 200) : null,
        color: d.book.coverColor,
        sub: d.book.author ?? "Unknown author",
        kind: null,
        open: () => router.push(`/book/${d.book.id}`),
        // By reference, not the saved copy: it carries on from the newest place, not the one when it was downloaded.
        play: () => void playRef({ itemType: "book", itemId: d.book.id }),
      };
    case "podcast":
      return {
        cover: d.episode.podcastCoverHash ? apiPaths.podcastCoverUrl(d.episode.podcastId, d.episode.podcastCoverHash, 200) : null,
        color: d.episode.podcastCoverColor,
        sub: d.episode.podcastTitle,
        kind: null,
        open: () => router.push(`/show/${d.episode.podcastId}`),
        play: () => void playRef({ itemType: "episode", itemId: d.episode.id }),
      };
    case "album":
      return {
        cover: albumCover(d.album.id, d.album.coverHash),
        color: d.album.coverColor,
        sub: d.album.artist,
        kind: `Album, ${plural(d.album.tracks.length, "song")}`,
        open: () => router.push(`/album/${d.album.id}`),
        play: () => playMusic({ kind: "album", refId: d.album.id, title: d.album.title, tracks: d.album.tracks }, 0),
      };
    case "track":
      return {
        cover: albumCover(d.track.albumId, d.track.coverHash),
        color: null,
        sub: d.track.artist,
        kind: "Song",
        open: () => router.push(`/album/${d.track.albumId}`),
        play: () => playMusic({ kind: "album", refId: d.track.albumId, title: d.track.album, tracks: [d.track] }, 0),
      };
    case "movie":
      return {
        cover: d.movie.posterHash ? apiPaths.movieArtUrl(d.movie.id, "poster", d.movie.posterHash, "small") : null,
        color: d.movie.color,
        aspectRatio: 2 / 3,
        sub: d.movie.year ?? "Movie",
        kind: null,
        open: () => openMovie(d.movie.id),
        play: () => openVideoPlayer({ kind: "movie", id: d.movie.id, version: d.versionId === d.movie.versionList[0]?.id ? undefined : d.versionId }),
      };
    case "show":
      return {
        cover: d.episode.stillHash ? apiPaths.videoStillUrl(d.episode.id, d.episode.stillHash, "small") : null,
        color: d.show.color,
        aspectRatio: 16 / 9,
        sub: episodeLabel(d.episode.season, d.episode.episode),
        kind: null,
        open: () => openTvShow(d.show.id),
        play: () => openVideoPlayer({ kind: "episode", id: d.episode.id, showId: d.show.id }),
      };
  }
}

function DownloadRow({ download, onRemove }: { download: Download; onRemove: () => void }) {
  const t = useTheme();
  const d = useDownload(download.type, download.id) ?? download;
  const v = describe(d);
  const title = titleOf(d);
  const ratio = ("aspectRatio" in v && v.aspectRatio) || 1;
  // Already loaded in the player, so Play only resumes it.
  const current = usePlayerSelect((s) =>
    d.type === "book"
      ? isCurrent(s, "book", d.book.id)
      : d.type === "podcast"
        ? isCurrent(s, "episode", d.episode.id)
        : d.type === "album"
          ? isPlayingFrom(s, "album", d.album.id)
          : d.type === "track" && isCurrent(s, "track", d.track.id),
  );
  // Music says what it is too: "Album, 13 songs, 118 MB".
  const size = v.kind ? `${v.kind}, ${formatBytes(d.bytes)}` : formatBytes(d.bytes);

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={v.open} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}>
        {/* Posters and stills keep their shape, at the cover's height. */}
        <Cover path={v.cover} title={title} color={v.color ?? null} size={56 * ratio} aspectRatio={ratio} radius={8} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={2} style={{ fontSize: 15, lineHeight: 20 }}>
            {title}
          </Text>
          <Text variant="small" numberOfLines={1}>
            {v.sub}
          </Text>
          <Text variant="small" style={d.status === "error" ? { color: t.danger } : d.status === "downloading" ? { color: t.accent } : undefined}>
            {d.status === "downloading" ? downloadingText(d) : d.status === "error" ? "Download failed" : size}
          </Text>
        </View>
      </Pressable>
      {d.status === "done" ? (
        <IconButton
          label={`Play ${title}`}
          onPress={() => {
            v.play();
            // Starting audio opens the full player; video opens its own.
            if (!current && d.type !== "movie" && d.type !== "show") router.push("/player");
          }}
        >
          <PlayIcon size={20} color={t.text} />
        </IconButton>
      ) : null}
      <IconButton label={d.status === "downloading" ? "Cancel download" : "Remove download"} onPress={onRemove} style={{ marginRight: -10 }}>
        <CloseIcon size={20} color={t.muted} />
      </IconButton>
    </View>
  );
}
