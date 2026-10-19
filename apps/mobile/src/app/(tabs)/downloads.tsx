import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { apiPaths } from "@murmur/shared";
import { Cover } from "@/components/cover";
import { CloseIcon, PlayIcon } from "@/components/icons";
import { PAD } from "@/components/library";
import { Empty, PageTitle, SectionTitle, useTopInset } from "@/components/page";
import { ConfirmSheet, RemoveDownloadSheet } from "@/components/sheet";
import { IconButton, Text } from "@/components/ui";
import { formatBytes, removeAllDownloads, removeDownload, useDownloads, type Download } from "@/lib/downloads";
import { bookToPlayable, episodeToPlayable, play } from "@/player/engine";
import { fonts, useTheme } from "@/theme";

/** Everything saved on this phone for offline listening, with sizes and a remove action. */
export default function Downloads() {
  const t = useTheme();
  const top = useTopInset();
  const all = Object.values(useDownloads()).sort((a, b) => b.savedAt - a.savedAt);
  const books = all.filter((d) => d.type === "book");
  const episodes = all.filter((d) => d.type === "episode");
  const bytes = all.reduce((sum, d) => sum + d.bytes, 0);
  const [removing, setRemoving] = useState<Download | null>(null);
  const [removingAll, setRemovingAll] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: 24 }}>
        <PageTitle
          title="Downloads"
          count={all.length || undefined}
          sub={bytes > 0 ? `${formatBytes(bytes)} on this phone` : null}
          right={
            all.length ? (
              <Pressable accessibilityRole="button" onPress={() => setRemovingAll(true)} hitSlop={10} style={{ paddingBottom: 6 }}>
                <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: t.danger }}>Remove all</Text>
              </Pressable>
            ) : null
          }
        />
        {all.length === 0 ? (
          <Empty title="Nothing downloaded">Download books and episodes from their pages to listen without a connection.</Empty>
        ) : null}
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
      </ScrollView>

      <RemoveDownloadSheet
        open={removing !== null}
        title={removing ? titleOf(removing) : ""}
        onConfirm={() => removing && removeDownload(removing.type, removing.id)}
        onClose={() => setRemoving(null)}
      />
      <ConfirmSheet
        open={removingAll}
        title="Remove all downloads?"
        message="Everything downloaded is deleted from this phone. Books and episodes stay on the server, so you can download them again."
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
  return d.type === "book" ? d.book.title : d.episode.title;
}

function DownloadRow({ download: d, onRemove }: { download: Download; onRemove: () => void }) {
  const t = useTheme();
  const book = d.type === "book" ? d.book : null;
  const episode = d.type === "episode" ? d.episode : null;
  const cover = book
    ? book.coverHash
      ? apiPaths.coverUrl(book.id, book.coverHash, 200)
      : null
    : episode?.podcastCoverHash
      ? apiPaths.podcastCoverUrl(episode.podcastId, episode.podcastCoverHash, 200)
      : null;
  const title = titleOf(d);
  const sub = book ? (book.author ?? "Unknown author") : (episode?.podcastTitle ?? "");
  const open = () => router.push(book ? `/book/${book.id}` : `/show/${episode!.podcastId}`);

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={open} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Cover path={cover} title={title} color={book ? book.coverColor : (episode?.podcastCoverColor ?? null)} size={56} radius={8} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={2} style={{ fontSize: 15, lineHeight: 20 }}>
            {title}
          </Text>
          <Text variant="small" numberOfLines={1}>
            {sub}
          </Text>
          <Text variant="small" style={d.status === "error" ? { color: t.danger } : d.status === "downloading" ? { color: t.accent } : undefined}>
            {d.status === "downloading" ? `Downloading ${Math.round(d.progress * 100)}%` : d.status === "error" ? "Download failed" : formatBytes(d.bytes)}
          </Text>
        </View>
      </Pressable>
      {d.status === "done" ? (
        <IconButton label={`Play ${title}`} onPress={() => play(book ? bookToPlayable(book) : episodeToPlayable(episode!))}>
          <PlayIcon size={20} color={t.text} />
        </IconButton>
      ) : null}
      <IconButton label={d.status === "downloading" ? "Cancel download" : "Remove download"} onPress={onRemove} style={{ marginRight: -10 }}>
        <CloseIcon size={20} color={t.muted} />
      </IconButton>
    </View>
  );
}
