import { memo, useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { apiPaths, bookListening, bookStarted, type BookSummary, errorText, progressPct } from "@murmur/shared/client";
import { api } from "@/lib/api";
import { fetchBook, removeBooks, setPlayNext } from "@/lib/data";
import { useDownload } from "@/lib/downloads";
import { selectHaptic, withLongPressHaptic } from "@/lib/haptics";
import { queryClient } from "@/lib/query";
import { useIsAdmin } from "@/lib/session";
import { bookToPlayable, currentMarkTarget, isCurrent, markProgress, play, toggle, usePlayerSelect } from "@/player/engine";
import { useTheme } from "@/theme";
import { BookEditSheet, type BookEditTab } from "./book-edit";
import { Cover } from "./cover";
import { CheckIcon, DownloadIcon } from "./icons";
import { Mixer, useNowPlaying } from "./mixer";
import { PickDisc, useSelection } from "./selection";
import { HideItem, RemoveBooksSheet, Sheet, SheetDivider, SheetItem, useCardMenu, useMenuIdle } from "./sheet";
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
  const sel = useSelection();
  const selecting = !!sel?.selecting;
  const on = selecting && sel.picked.has(book.id);
  // While selecting, a tap (or a long press) picks the card instead of opening it.
  const pick = () => {
    selectHaptic();
    sel?.pick(book.id);
  };
  return (
    <Pressable
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityLabel={book.title}
      accessibilityState={selecting ? { checked: on } : undefined}
      accessibilityActions={selecting ? undefined : [{ name: "longpress", label: "Options" }]}
      onAccessibilityAction={menu.show}
      onPress={selecting ? pick : () => router.push(`/book/${book.id}`)}
      onLongPress={selecting ? pick : withLongPressHaptic(menu.show)}
      style={({ pressed }) => ({ width, gap: 6, opacity: pressed ? 0.75 : 1 })}
    >
      {menu.shown ? <BookActions book={book} open={menu.open} onClose={menu.close} onIdle={menu.idle} /> : null}
      <View>
        <Cover path={book.coverHash ? apiPaths.coverUrl(book.id, book.coverHash, 200) : null} title={book.title} color={book.coverColor} />
        {on ? <View pointerEvents="none" style={{ position: "absolute", inset: 0, borderRadius: 10, borderWidth: 3, borderColor: t.accent }} /> : null}
        {selecting ? (
          <PickDisc on={on} />
        ) : book.progress?.finished ? (
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
 * What can be done to a book, the same from its card's menu and its page (like the web's): whether
 * it's the one loaded, marking it finished, and putting it on Play next.
 */
export function useBookActions(book: BookSummary) {
  const current = usePlayerSelect((s) => isCurrent(s, "book", book.id));
  const onPlayNext = book.playNext != null;
  return {
    current,
    // Playing a finished book starts it over, so while it's loaded it isn't finished.
    finished: !!book.progress?.finished && !current,
    onPlayNext,
    /** A started book is in Continue listening, so it can't go on Play next. */
    canPlayNext: !current && !bookStarted(book),
    async markFinished(done: boolean) {
      try {
        // The loaded one is where the player has it, not where the list last heard.
        const before = current ? currentMarkTarget() : null;
        await markProgress(
          [before ?? { itemType: "book", itemId: book.id, durationSec: book.durationSec, positionSec: book.progress?.positionSec ?? 0, finished: !!book.progress?.finished }],
          done,
          done ? "Marked as finished" : "Marked as not finished",
        );
      } catch (err) {
        toast.error(errorText(err));
      }
    },
    /** Says so itself, with an Undo, or what went wrong. */
    togglePlayNext: () => void setPlayNext(book.id, !onPlayNext),
  };
}

/**
 * A book's menu, the same from a card's long press and the book page's ⋯ (like the web's): play,
 * Play next and finished, Select (in a grid that can pick several) and Hide, then for admins Edit,
 * Match, Mark as matched and Remove from library last.
 */
export function BookActions({
  book,
  open,
  onClose,
  onIdle,
  onHidden,
  onRemoved,
  selectable = true,
}: {
  book: BookSummary;
  open: boolean;
  onClose: () => void;
  onIdle?: () => void;
  /** False for a card that can't be picked, like Continue listening's: no Select. */
  selectable?: boolean;
  /** On the book's own page: goes back once it's hidden. */
  onHidden?: () => void;
  /** On the book's own page: leaves it once the book is removed from the library. */
  onRemoved?: () => void;
}) {
  const playing = usePlayerSelect((s) => s.playing);
  const admin = useIsAdmin();
  const [editing, setEditing] = useState<BookEditTab | null>(null);
  const [removing, setRemoving] = useState(false);
  const selection = useSelection();
  useMenuIdle(open || editing !== null || removing, onIdle);
  const { current, finished, onPlayNext, canPlayNext, markFinished, togglePlayNext } = useBookActions(book);

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
    await api(apiPaths.bookMatchMarked(book.id),{ method: marked ? "POST" : "DELETE" });
    void queryClient.invalidateQueries();
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title={book.title}>
        <SheetItem
          label={current && playing ? "Pause" : bookListening(book) ? "Continue" : "Play"}
          onPress={run(async () => {
            if (current) return toggle();
            play(bookToPlayable(await fetchBook(book.id)), finished ? 0 : undefined);
          })}
        />
        {canPlayNext ? <SheetItem label={onPlayNext ? "Remove from Play next" : "Add to Play next"} onPress={run(togglePlayNext)} /> : null}
        <SheetItem label={finished ? "Mark as not finished" : "Mark as finished"} onPress={run(() => markFinished(!finished))} />
        {selection && selectable ? <SheetItem label="Select" onPress={run(() => selection.start(book.id))} /> : null}
        <HideItem kind="book" id={book.id} title={book.title} onClose={onClose} onHidden={onHidden} divider={false} />
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
            <SheetItem
              label="Remove from library…"
              danger
              onPress={() => {
                onClose();
                setRemoving(true);
              }}
            />
          </>
        ) : null}
      </Sheet>
      {admin ? (
        <>
          <BookEditSheet bookId={book.id} title={book.title} tab={editing} onClose={() => setEditing(null)} onRemoved={onRemoved} />
          <RemoveBooksSheet
            open={removing}
            books={[book]}
            onConfirm={() => void removeBooks([book]).then(onRemoved, (err: unknown) => toast.error(errorText(err)))}
            onClose={() => setRemoving(false)}
          />
        </>
      ) : null}
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
