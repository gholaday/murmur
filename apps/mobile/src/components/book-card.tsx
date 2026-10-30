import { memo, useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { apiPaths, bookListening, bookStarted, type BookSummary, errorText, progressPct } from "@murmur/shared/client";
import { api } from "@/lib/api";
import { fetchBook, setPlayNext } from "@/lib/data";
import { useDownload } from "@/lib/downloads";
import { withLongPressHaptic } from "@/lib/haptics";
import { queryClient } from "@/lib/query";
import { useSession } from "@/lib/session";
import { bookToPlayable, isCurrent, markCurrent, play, setFinished, toggle, usePlayer } from "@/player/engine";
import { useTheme } from "@/theme";
import { BookEditSheet, type BookEditTab } from "./book-edit";
import { Cover } from "./cover";
import { CheckIcon, DownloadIcon } from "./icons";
import { Mixer, useNowPlaying } from "./mixer";
import { Sheet, SheetDivider, SheetItem, useCardMenu, useMenuIdle } from "./sheet";
import { toast } from "./toast";
import { Bar, Text } from "./ui";

/**
 * Cover, title and a line under it; used in every book grid. Memoized: grids re-render for
 * player and download changes that rarely touch an individual card.
 */
export const BookCard = memo(function BookCard({ book, sub, width }: { book: BookSummary; sub?: string | null; width: number }) {
  const t = useTheme();
  const dl = useDownload("book", book.id);
  const pct = progressPct(book);
  const started = !!book.progress && !book.progress.finished && pct > 0;
  const menu = useCardMenu();
  const now = useNowPlaying((s) => isCurrent(s, "book", book.id));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={book.title}
      accessibilityActions={[{ name: "longpress", label: "Options" }]}
      onAccessibilityAction={menu.show}
      onPress={() => router.push(`/book/${book.id}`)}
      onLongPress={withLongPressHaptic(menu.show)}
      style={({ pressed }) => ({ width, gap: 6, opacity: pressed ? 0.75 : 1 })}
    >
      {menu.shown ? <BookActions book={book} open={menu.open} onClose={menu.close} onIdle={menu.idle} /> : null}
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
        {now ? <Mixer playing={now === "playing"} /> : null}
      </View>
      {started ? <Bar pct={pct} /> : null}
      <View>
        <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14, color: now ? t.accent : t.text }}>
          {book.title}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {sub === undefined ? (book.author ?? "Unknown author") : (sub ?? " ")}
        </Text>
      </View>
    </Pressable>
  );
});

/**
 * A book's menu, the same from a card's long press and the book page's ⋯ (like the web's): play,
 * Play next and finished, then for admins Edit, Match and Mark as matched.
 */
export function BookActions({ book, open, onClose, onIdle }: { book: BookSummary; open: boolean; onClose: () => void; onIdle?: () => void }) {
  const player = usePlayer();
  const admin = !!useSession().user?.isAdmin;
  const [editing, setEditing] = useState<BookEditTab | null>(null);
  useMenuIdle(open || editing !== null, onIdle);
  const current = isCurrent(player, "book", book.id);
  const finished = !!book.progress?.finished;

  const run = (fn: () => Promise<unknown> | void, done?: string) => async () => {
    onClose();
    try {
      await fn();
      if (done) toast.show(done);
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  const edit = (tab: BookEditTab) => () => {
    onClose();
    setEditing(tab);
  };
  const markMatched = async (marked: boolean) => {
    await api(`/api/books/${book.id}/match/marked`, { method: marked ? "POST" : "DELETE" });
    void queryClient.invalidateQueries();
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title={book.title}>
        <SheetItem
          label={current && player.playing ? "Pause" : bookListening(book) ? "Continue" : "Play"}
          onPress={run(async () => {
            if (current) return toggle();
            play(bookToPlayable(await fetchBook(book.id)), finished ? 0 : undefined);
          })}
        />
        {/* Started books are in Continue listening instead. */}
        {bookStarted(book) || current ? null : (
          <SheetItem label={book.playNext != null ? "Remove from Play next" : "Add to Play next"} onPress={run(() => setPlayNext(book.id, book.playNext == null))} />
        )}
        <SheetItem
          label={finished ? "Mark as not finished" : "Mark as finished"}
          onPress={run(
            () => (current ? markCurrent(!finished) : setFinished("book", book.id, book.durationSec, !finished)),
            finished ? "Marked as not finished" : "Marked as finished",
          )}
        />
        {admin ? (
          <>
            <SheetDivider />
            <SheetItem label="Edit…" onPress={edit("details")} />
            <SheetItem label="Match…" onPress={edit("match")} />
            {/* Not offered once a real match was applied: Undo all edits in Edit is the way back there. */}
            {!book.matched || book.markedMatched ? (
              <SheetItem
                label={book.markedMatched ? "Mark as not matched" : "Mark as matched"}
                onPress={run(() => markMatched(!book.markedMatched), book.markedMatched ? "Marked as not matched" : "Marked as matched")}
              />
            ) : null}
          </>
        ) : null}
      </Sheet>
      {admin ? <BookEditSheet bookId={book.id} title={book.title} tab={editing} onClose={() => setEditing(null)} /> : null}
    </>
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
