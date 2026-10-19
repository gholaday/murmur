import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { apiPaths, type BookSummary } from "@murmur/shared";
import { fetchBook, setFinished } from "@/lib/data";
import { useDownload } from "@/lib/downloads";
import { bookToPlayable, isCurrent, markCurrent, play, queueAdd, toggle, usePlayer } from "@/player/engine";
import { useTheme } from "@/theme";
import { Cover } from "./cover";
import { CheckIcon, DownloadIcon } from "./icons";
import { Sheet, SheetItem } from "./sheet";
import { toast } from "./toast";
import { Bar, Text } from "./ui";

export function progressPct(b: BookSummary): number {
  if (!b.progress || b.durationSec <= 0) return 0;
  return Math.min(100, (b.progress.positionSec / b.durationSec) * 100);
}

/** Cover, title and a line under it; used in every book grid. */
export function BookCard({ book, sub, width }: { book: BookSummary; sub?: string | null; width: number }) {
  const t = useTheme();
  const dl = useDownload("book", book.id);
  const pct = progressPct(book);
  const started = !!book.progress && !book.progress.finished && pct > 0;
  const [menu, setMenu] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={book.title}
      accessibilityActions={[{ name: "longpress", label: "Options" }]}
      onAccessibilityAction={() => setMenu(true)}
      onPress={() => router.push(`/book/${book.id}`)}
      onLongPress={() => setMenu(true)}
      style={({ pressed }) => ({ width, gap: 6, opacity: pressed ? 0.75 : 1 })}
    >
      {menu ? <BookMenu book={book} started={started} onClose={() => setMenu(false)} /> : null}
      <View>
        <Cover path={book.coverHash ? apiPaths.coverUrl(book.id, book.coverHash, 200) : null} title={book.title} color={book.coverColor} />
        {book.progress?.finished ? (
          <Badge>
            <CheckIcon size={14} color={t.onAccent} />
          </Badge>
        ) : dl?.status === "done" ? (
          <Badge>
            <DownloadIcon size={13} color={t.onAccent} />
          </Badge>
        ) : null}
      </View>
      {started ? <Bar pct={pct} /> : null}
      <View>
        <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14 }}>
          {book.title}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {sub === undefined ? (book.author ?? "Unknown author") : (sub ?? " ")}
        </Text>
      </View>
    </Pressable>
  );
}

/** Long-press options for a book card: the listener actions from the book page. */
function BookMenu({ book, started, onClose }: { book: BookSummary; started: boolean; onClose: () => void }) {
  const player = usePlayer();
  const current = isCurrent(player, "book", book.id);
  const finished = !!book.progress?.finished;
  const queued = player.queue.some((q) => q.itemType === "book" && q.itemId === book.id);

  const run = (fn: () => Promise<unknown> | void, done?: string) => async () => {
    onClose();
    try {
      await fn();
      if (done) toast.show(done);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  const playLabel = current ? (player.playing ? "Pause" : "Resume") : started ? "Continue" : "Play";
  return (
    <Sheet open onClose={onClose} title={book.title}>
      <SheetItem
        label={playLabel}
        onPress={run(async () => {
          if (current) return toggle();
          play(bookToPlayable(await fetchBook(book.id)), finished ? 0 : undefined);
        })}
      />
      <SheetItem label="Play next" disabled={current} onPress={run(() => queueAdd({ itemType: "book", itemId: book.id }, "next"), "Plays next")} />
      <SheetItem
        label={queued ? "In Up Next" : "Add to Up Next"}
        disabled={current || queued}
        onPress={run(() => queueAdd({ itemType: "book", itemId: book.id }, "last"), "Added to Up Next")}
      />
      <SheetItem
        label={finished ? "Mark as not finished" : "Mark as finished"}
        onPress={run(
          () => (current ? markCurrent(!finished) : setFinished("book", book.id, book.durationSec, !finished)),
          finished ? "Marked as not finished" : "Marked as finished",
        )}
      />
    </Sheet>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={{
        position: "absolute",
        top: 6,
        right: 6,
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: t.accent,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </View>
  );
}
