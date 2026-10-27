import { memo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { apiPaths, type BookDetail, chapterAt, duration, plural, timeLeft } from "@murmur/shared/client";
import { Cover } from "@/components/cover";
import { BottomMiniPlayer } from "@/components/mini-player";
import { HeroBackdrop } from "@/components/hero";
import { CheckIcon, DownloadIcon, MoreIcon, PauseIcon, PlayIcon, PlayNextAddIcon } from "@/components/icons";
import { openGroup, PAD } from "@/components/library";
import { BackRow, Empty, NestedFallback, useBottomPad, SectionTitle, useTopInset } from "@/components/page";
import { RemoveDownloadSheet, Sheet, SheetItem } from "@/components/sheet";
import { FadeIn } from "@/components/skeleton";
import { toast } from "@/components/toast";
import { Bar, IconButton, Text } from "@/components/ui";
import { setFinished, setPlayNext, useBook } from "@/lib/data";
import { downloadBook, getDownload, removeDownload, useDownload, type Download } from "@/lib/downloads";
import {
  bookToPlayable,
  isCurrent,
  markCurrent,
  play,
  toggle,
  useItemPosition,
  usePlayer,
} from "@/player/engine";
import { fonts, useTheme } from "@/theme";

export default function BookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useBook(id);
  const dl = useDownload("book", id);
  // Offline and never opened before: the download keeps its own copy of the details.
  const saved = dl?.type === "book" ? dl.book : undefined;
  const book = query.data ?? saved;
  // Only a page that had to wait fades in; one already cached shows at once.
  const [waited] = useState(!book);

  if (!book) {
    return (
      <NestedFallback>{query.isError ? <Empty title="Couldn't load this book">{query.error.message}</Empty> : null}</NestedFallback>
    );
  }
  return (
    <FadeIn when={waited} style={{ flex: 1 }}>
      <BookView book={book} download={dl} />
    </FadeIn>
  );
}

function BookView({ book, download }: { book: BookDetail; download: Download | undefined }) {
  const t = useTheme();
  const top = useTopInset();
  const bottomPad = useBottomPad();
  const player = usePlayer();
  const live = useItemPosition("book", book.id) ?? 0;
  const [menu, setMenu] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const current = isCurrent(player, "book", book.id);
  const finished = !!book.progress?.finished && !current;
  const position = current ? live : book.progress && !book.progress.finished ? book.progress.positionSec : 0;
  const started = position > 5;
  const pct = book.durationSec ? Math.min(100, (position / book.durationSec) * 100) : 0;
  const currentChapter = started || current ? chapterAt(book.chapters, position) : -1;
  // Only a book not yet started can wait on Play next; it leaves the shelf once it starts.
  const canPlayNext = !started && !current && !book.progress?.finished;
  const onPlayNext = book.playNext != null;
  const left = timeLeft(book.durationSec, position);
  const [playLabel, playSub] = current
    ? player.playing
      ? ["Pause", left]
      : ["Resume", left]
    : finished
      ? ["Play", duration(book.durationSec)]
      : started
        ? ["Continue", left]
        : ["Play", duration(book.durationSec)];

  const onPlay = () => (current ? toggle() : play(bookToPlayable(book), finished ? 0 : undefined));

  const mark = async (done: boolean) => {
    setMenu(false);
    try {
      if (current) markCurrent(done);
      else await setFinished("book", book.id, book.durationSec, done);
      toast.show(done ? "Marked as finished" : "Marked as not finished");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that.");
    }
  };

  const toggleDownload = () => {
    setMenu(false);
    const existing = getDownload("book", book.id);
    // A finished download is asked about first; cancelling one in progress isn't.
    if (existing?.status === "done") setConfirmRemove(true);
    else if (existing) removeDownload("book", book.id);
    else downloadBook(book);
  };

  const cover600 = book.coverHash ? apiPaths.coverUrl(book.id, book.coverHash, 600) : null;
  const downloadLabel =
    download?.status === "done"
      ? "Remove download"
      : download?.status === "downloading"
        ? `Downloading ${Math.round(download.progress * 100)}%`
        : download?.status === "error"
          ? "Download failed, try again"
          : "Download";

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: bottomPad }}>
        <View style={{ paddingTop: top, paddingHorizontal: PAD }}>
          <HeroBackdrop path={cover600} color={book.coverColor} height={top + 460} />
          <BackRow
            right={
              <IconButton label="More options" onPress={() => setMenu(true)} style={{ marginRight: -10 }}>
                <MoreIcon color={t.text} />
              </IconButton>
            }
          />
          <View style={{ alignItems: "center", gap: 6, marginTop: 4 }}>
            <View style={{ width: 210, borderRadius: 12, elevation: 12, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 12 } }}>
              <Cover path={cover600} title={book.title} color={book.coverColor} radius={12} />
            </View>
            {book.series ? (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
                <Pressable accessibilityRole="link" onPress={() => openGroup({ series: book.series! })} hitSlop={6}>
                  <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: t.accent }}>{book.series}</Text>
                </Pressable>
                {book.seriesPosition !== null ? <Text variant="small" style={{ fontFamily: fonts.semibold }}>Book {book.seriesPosition}</Text> : null}
              </View>
            ) : (
              <View style={{ height: 14 }} />
            )}
            <Text variant="title" style={{ fontSize: 24, textAlign: "center" }}>
              {book.title}
            </Text>
            {book.author ? (
              <Pressable accessibilityRole="link" onPress={() => openGroup({ author: book.author! })} hitSlop={6}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: t.accent }}>{book.author}</Text>
              </Pressable>
            ) : (
              <Text variant="small">Unknown author</Text>
            )}
            {book.narrator ? <Text variant="small" style={{ color: t.text2 }}>Narrated by {book.narrator}</Text> : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", columnGap: 14 }}>
              <Text variant="small">{duration(book.durationSec)}</Text>
              {book.year ? <Text variant="small">{book.year}</Text> : null}
              {book.chapters.length > 1 ? <Text variant="small">{plural(book.chapters.length, "chapter")}</Text> : null}
              {book.missingSince ? <Text variant="small" style={{ color: t.danger }}>Files missing</Text> : null}
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 22 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${playLabel}, ${playSub}`}
              onPress={onPlay}
              style={({ pressed }) => ({
                flex: 1,
                height: 56,
                borderRadius: 28,
                backgroundColor: t.accent,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                paddingHorizontal: 16,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              {current && player.loading ? (
                <ActivityIndicator color={t.onAccent} />
              ) : current && player.playing ? (
                <PauseIcon size={22} color={t.onAccent} />
              ) : (
                <PlayIcon size={22} color={t.onAccent} />
              )}
              {/* The action stays in the accessibility label; the icon says it on screen. */}
              <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.bold, fontSize: 15, color: t.onAccent }}>
                {playSub}
              </Text>
            </Pressable>
            {canPlayNext ? (
              <RoundButton
                label={onPlayNext ? "Remove from Play next" : "Add to Play next"}
                active={onPlayNext}
                filled={onPlayNext}
                onPress={() => void setPlayNext(book.id, !onPlayNext)}
              >
                <PlayNextAddIcon size={22} on={onPlayNext} color={onPlayNext ? t.onAccent : t.text} />
              </RoundButton>
            ) : null}
            <RoundButton label={downloadLabel} active={download?.status === "done"} onPress={toggleDownload}>
              {download?.status === "downloading" ? (
                <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: t.accent }}>{Math.round(download.progress * 100)}%</Text>
              ) : (
                <DownloadIcon size={22} color={download?.status === "done" ? t.accent : download?.status === "error" ? t.danger : t.text} />
              )}
            </RoundButton>
            <RoundButton
              label={book.progress?.finished ? "Mark as not finished" : "Mark as finished"}
              active={!!book.progress?.finished}
              onPress={() => void mark(!book.progress?.finished)}
            >
              <CheckIcon size={22} color={book.progress?.finished ? t.accent : t.text} />
            </RoundButton>
          </View>
          {started || current ? (
            <View style={{ marginTop: 14 }}>
              <Bar pct={pct} height={4} />
            </View>
          ) : null}

          {book.description ? (
            <Pressable onPress={() => setExpanded((e) => !e)} style={{ marginTop: 18, gap: 4 }}>
              <Text numberOfLines={expanded ? undefined : 4}>{book.description}</Text>
              {book.description.length > 220 ? (
                <Text variant="small" style={{ color: t.accent, fontFamily: fonts.bold }}>
                  {expanded ? "Less" : "More"}
                </Text>
              ) : null}
            </Pressable>
          ) : null}

          {book.chapters.length > 1 ? <ChapterList book={book} currentChapter={currentChapter} /> : null}
        </View>
      </ScrollView>

      <BottomMiniPlayer />
      <Sheet open={menu} onClose={() => setMenu(false)} title={book.title}>
        {canPlayNext ? (
          <SheetItem
            label={onPlayNext ? "Remove from Play next" : "Add to Play next"}
            onPress={() => {
              setMenu(false);
              void setPlayNext(book.id, !onPlayNext);
            }}
          />
        ) : null}
        <SheetItem label={downloadLabel} onPress={toggleDownload} />
        <SheetItem label={book.progress?.finished ? "Mark as not finished" : "Mark as finished"} onPress={() => void mark(!book.progress?.finished)} />
        {book.progress && !book.progress.finished ? <SheetItem label="Reset progress" onPress={() => void mark(false)} /> : null}
      </Sheet>
      <RemoveDownloadSheet
        open={confirmRemove}
        title={book.title}
        onConfirm={() => removeDownload("book", book.id)}
        onClose={() => setConfirmRemove(false)}
      />
    </View>
  );
}

/** Memoized so playback ticks only redraw it when the chapter changes, not twice a second. */
const ChapterList = memo(function ChapterList({ book, currentChapter }: { book: BookDetail; currentChapter: number }) {
  const t = useTheme();
  return (
    <>
      <SectionTitle title="Chapters" count={book.chapters.length} />
      {book.chapters.map((c, i) => {
        const now = i === currentChapter;
        const done = i < currentChapter;
        return (
          <Pressable
            key={c.index}
            accessibilityRole="button"
            accessibilityLabel={`Play ${c.title}`}
            onPress={() => play(bookToPlayable(book), c.startSec)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              minHeight: 52,
              borderBottomWidth: 1,
              borderBottomColor: t.line,
              opacity: pressed ? 0.6 : done ? 0.55 : 1,
            })}
          >
            <Text variant="small" style={{ width: 28, color: now ? t.accent : t.muted }}>
              {i + 1}
            </Text>
            <Text numberOfLines={2} style={{ flex: 1, fontFamily: now ? fonts.bold : fonts.medium, color: now ? t.accent : t.text }}>
              {c.title}
            </Text>
            <Text variant="small">{duration(c.endSec - c.startSec)}</Text>
          </Pressable>
        );
      })}
    </>
  );
});

function RoundButton({
  label,
  active,
  filled,
  disabled,
  onPress,
  children,
}: {
  label: string;
  active?: boolean;
  /** Solid accent background, for an "on" state. */
  filled?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: filled ? t.accent : pressed ? t.surface2 : t.chip,
        opacity: disabled ? 0.4 : pressed && filled ? 0.85 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}
