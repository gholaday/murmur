import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BackHandler, Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "expo-router";
import {
  BULK_EDIT_FIELDS,
  bulkChanges,
  bulkForm,
  bulkStart,
  type BookSummary,
  type BulkEditField,
  type BulkEditForm,
  errorText,
  type KnownSeries,
  MIXED,
  plural,
  selectedLabel,
  togglePick,
} from "@murmur/shared/client";
import { editBooks, fetchBook, removeBooks, useBooks } from "@/lib/data";
import { downloadBook, getDownload } from "@/lib/downloads";
import { hideBooks, useCanHideAndLike } from "@/lib/hidden";
import { useIsAdmin } from "@/lib/session";
import { isCurrent, markCurrent, usePlayerSelect } from "@/player/engine";
import { queueProgress } from "@/player/progress";
import { fonts, useTheme } from "@/theme";
import { useSeriesSuggest } from "./book-edit";
import { CheckIcon, CloseIcon, DownloadIcon, MoreIcon } from "./icons";
import { BookCoverStack, RemoveBooksSheet, Sheet, SheetItem } from "./sheet";
import { toast } from "./toast";
import { Caption, EditFoot, Input, LinkButton, Text } from "./ui";

// Picking several books in a grid and acting on them at once, like the web's select mode.

interface Selection {
  selecting: boolean;
  picked: ReadonlySet<string>;
  pick: (id: string) => void;
  /** Starts selecting, with this card already picked when it came from its menu. */
  start: (id?: string) => void;
}

const SelectionContext = createContext<Selection | null>(null);
/** Set inside a full grid of books that can be picked several at a time. */
export const useSelection = () => useContext(SelectionContext);

type Open = "more" | "edit" | "remove" | null;

/**
 * Around the books on a screen (All books, a shelf, an author, a series, Library's tabs): cards can
 * be picked several at a time, with two cards pinned at the top: the count and Select all, then the
 * actions. The mini player stays where it is. `books` is what's on screen, in order and each once; a
 * book on two shelves is picked on both. A new `view` (another tab), or leaving the screen, stops
 * selecting.
 */
export function SelectionProvider({ books, view, children }: { books: BookSummary[]; view?: string; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  // A sheet keeps the books it opened with while it slides away, after selecting has stopped.
  const [open, setOpen] = useState<Open>(null);
  const [target, setTarget] = useState<BookSummary[]>([]);
  const [round, setRound] = useState(0);
  // Books that leave the list (removed, hidden) drop out of what's picked.
  const chosen = useMemo(() => books.filter((b) => picked.has(b.id)), [books, picked]);
  const current = usePlayerSelect((s) => chosen.find((b) => isCurrent(s, "book", b.id))?.id ?? null);

  const stop = useCallback(() => {
    setSelecting(false);
    setPicked(new Set());
  }, []);

  // Another view, or leaving the screen, stops selecting.
  const scope = `${view ?? ""}:${useIsFocused()}`;
  const [lastScope, setLastScope] = useState(scope);
  if (scope !== lastScope) {
    setLastScope(scope);
    setSelecting(false);
    setPicked(new Set());
  }

  // Back leaves select mode.
  useEffect(() => {
    if (!selecting) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      stop();
      return true;
    });
    return () => sub.remove();
  }, [selecting, stop]);

  const show = (which: Open) => {
    setTarget(chosen);
    if (which === "edit") setRound((r) => r + 1);
    setOpen(which);
  };
  const run = (fn: () => Promise<unknown>) => {
    stop();
    fn().catch((err: unknown) => toast.error(errorText(err)));
  };
  const actions = {
    finished: (done: boolean) => run(async () => markBooks(chosen, done, current)),
    download: () => run(() => downloadBooks(chosen)),
    more: () => show("more"),
  };

  const value: Selection = {
    selecting,
    picked,
    pick: (id) => setPicked((p) => togglePick(p, id)),
    start: (id) => {
      setSelecting(true);
      // A card that can't be picked (Continue listening) starts with nothing picked.
      setPicked(id && books.some((b) => b.id === id) ? new Set([id]) : new Set());
    },
  };

  return (
    <SelectionContext.Provider value={value}>
      <View style={{ flex: 1 }}>
        {children}
        {/* Pinned over the screen's head while the grid scrolls under it. */}
        {selecting ? (
          <Animated.View
            entering={FadeIn.duration(160)}
            exiting={FadeOut.duration(160)}
            style={{ position: "absolute", top: insets.top + 4, left: 12, right: 12 }}
          >
            <SelectBar books={chosen} all={books.length} onAll={() => setPicked(new Set(books.map((b) => b.id)))} onStop={stop} actions={actions} />
          </Animated.View>
        ) : null}
      </View>
      <MoreSheet
        open={open === "more"}
        books={target}
        onClose={() => setOpen(null)}
        onPick={(fn) => {
          setOpen(null);
          if (fn === "edit" || fn === "remove") setTimeout(() => show(fn), 250);
          else run(fn);
        }}
      />
      {round ? (
        <BulkEditSheet
          key={round}
          open={open === "edit"}
          books={target}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            stop();
          }}
        />
      ) : null}
      <RemoveBooksSheet open={open === "remove"} books={target} onConfirm={() => run(() => removeBooks(target))} onClose={() => setOpen(null)} />
    </SelectionContext.Provider>
  );
}

/** Finished, or back to the start; Undo puts each book back where it was. The loaded one goes through the player. */
async function markBooks(books: BookSummary[], done: boolean, current: string | null) {
  const updatedAt = Date.now();
  const item = (b: BookSummary, positionSec: number, finished: boolean) => ({ itemType: "book" as const, itemId: b.id, durationSec: b.durationSec, positionSec, finished, updatedAt });
  const before = books.filter((b) => b.id !== current).map((b) => item(b, b.progress?.positionSec ?? 0, !!b.progress?.finished));
  for (const b of books) {
    if (b.id === current) await markCurrent(done);
    else queueProgress(item(b, done ? b.durationSec : 0, done), true);
  }
  toast.show(`Marked ${plural(books.length, "book")} as ${done ? "finished" : "not finished"}`, {
    duration: 5000,
    action: { label: "Undo", onPress: () => before.forEach((b) => queueProgress({ ...b, updatedAt: Date.now() }, true)) },
  });
}

async function downloadBooks(books: BookSummary[]) {
  const wanted = books.filter((b) => !getDownload("book", b.id));
  if (!wanted.length) {
    toast.show(books.length === 1 ? "Already downloaded" : "All downloaded already");
    return;
  }
  toast.show(`Downloading ${plural(wanted.length, "book")}`);
  for (const b of wanted) downloadBook(await fetchBook(b.id));
}

/**
 * The one select bar, pinned at the top like phone web's: ✕, the count, All, then the actions.
 * Kept tight (4px gaps, 40px buttons) so it fits a 375-wide screen.
 */
function SelectBar({
  books,
  all,
  onAll,
  onStop,
  actions,
}: {
  books: BookSummary[];
  all: number;
  onAll: () => void;
  onStop: () => void;
  actions: { finished: (done: boolean) => void; download: () => void; more: () => void };
}) {
  const t = useTheme();
  const canHide = useCanHideAndLike();
  const admin = useIsAdmin();
  const count = books.length;
  const none = count === 0;
  const allFinished = !none && books.every((b) => b.progress?.finished);
  return (
    <View
      accessibilityRole="toolbar"
      style={{
        height: 52,
        paddingHorizontal: 4,
        gap: 4,
        flexDirection: "row",
        alignItems: "center",
        borderRadius: 14,
        backgroundColor: t.surface,
        elevation: 6,
        shadowColor: "#000",
        shadowOpacity: 0.3,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      }}
    >
      <BarAction label="Stop selecting" icon={<CloseIcon size={22} color={t.text} />} onPress={onStop} />
      <Text
        accessibilityLiveRegion="polite"
        numberOfLines={1}
        style={{ flex: 1, minWidth: 0, fontFamily: none ? fonts.semibold : fonts.bold, fontSize: 15, color: none ? t.muted : t.text }}
      >
        {selectedLabel(count)}
      </Text>
      {count < all ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Select all"
          onPress={onAll}
          hitSlop={6}
          style={({ pressed }) => ({ height: 40, paddingHorizontal: 8, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: t.accent }}>All</Text>
        </Pressable>
      ) : null}
      <BarAction
        label={allFinished ? "Mark as not finished" : "Mark as finished"}
        disabled={none}
        icon={<CheckIcon size={22} color={t.accent} />}
        onPress={() => actions.finished(!allFinished)}
      />
      <BarAction label="Download" disabled={none} icon={<DownloadIcon size={22} color={t.accent} />} onPress={actions.download} />
      {/* More holds Hide, and Edit and Remove for admins; with none of those it has nothing to show. */}
      {canHide || admin ? <BarAction label="More" disabled={none} icon={<MoreIcon size={22} color={t.accent} />} onPress={actions.more} /> : null}
    </View>
  );
}

/** An icon-only 40px button, named for screen readers; dims to 40% when there's nothing to act on. */
function BarAction({ label, icon, disabled = false, onPress }: { label: string; icon: React.ReactNode; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({ width: 40, height: 40, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}
    >
      {icon}
    </Pressable>
  );
}

function MoreSheet({
  open,
  books,
  onClose,
  onPick,
}: {
  open: boolean;
  books: BookSummary[];
  onClose: () => void;
  onPick: (what: (() => Promise<unknown>) | "edit" | "remove") => void;
}) {
  const admin = useIsAdmin();
  const canHide = useCanHideAndLike();
  return (
    <Sheet open={open} onClose={onClose} title={selectedLabel(books.length)}>
      {canHide ? <SheetItem label="Hide" onPress={() => onPick(() => hideBooks(books.map((b) => b.id)))} /> : null}
      {admin ? (
        <>
          <SheetItem label="Edit…" onPress={() => onPick("edit")} />
          <SheetItem label="Remove from library…" danger onPress={() => onPick("remove")} />
        </>
      ) : null}
    </Sheet>
  );
}

/** Edit on several books: only the fields books share. A field they differ on shows Mixed until typed in. */
function BulkEditSheet({ open, books, onClose, onSaved }: { open: boolean; books: BookSummary[]; onClose: () => void; onSaved: () => void }) {
  const t = useTheme();
  const all = useBooks().data;
  const start = useMemo(() => bulkStart(books), [books]);
  const [form, setForm] = useState<BulkEditForm>(() => bulkForm(start));
  const [busy, setBusy] = useState(false);
  const changes = bulkChanges(start, form);
  const count = Object.keys(changes).length;
  // The library's series, for the Series field's suggestions.
  const known = useMemo<KnownSeries[]>(() => {
    const counts = new Map<string, number>();
    for (const b of all ?? []) if (b.series) counts.set(b.series, (counts.get(b.series) ?? 0) + 1);
    return [...counts].map(([name, books]) => ({ name, books }));
  }, [all]);
  const series = useSeriesSuggest(known, form.series, (name) => setForm({ ...form, series: name }));

  const save = async () => {
    setBusy(true);
    try {
      await editBooks(
        books.map((b) => b.id),
        changes,
      );
      onSaved();
    } catch (err) {
      toast.error(errorText(err));
      setBusy(false);
    }
  };

  const field = (f: BulkEditField, label: string) => {
    const set = (v: string) => setForm({ ...form, [f]: v });
    return (
      <View key={f} style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 18 }}>
          <Caption style={{ letterSpacing: 0.6 }}>{label}</Caption>
          {f in changes ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.accent }} />
                <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: t.accent }}>Edited</Text>
              </View>
              <View style={{ flex: 1 }} />
              <LinkButton label="Undo" onPress={() => set(bulkForm(start)[f])} />
            </>
          ) : null}
        </View>
        <Input
          accessibilityLabel={label}
          value={form[f]}
          placeholder={start[f] === null ? MIXED : f === "series" ? "None" : undefined}
          onChangeText={(text) => {
            set(text);
            if (f === "series") series.onType();
          }}
          {...(f === "series" ? series.inputProps : null)}
        />
      </View>
    );
  };

  const head = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
      <BookCoverStack books={books} size={48} />
      <Text variant="heading" style={{ flex: 1, fontFamily: fonts.extrabold }}>
        {`Edit ${plural(books.length, "book")}`}
      </Text>
    </View>
  );

  return (
    <Sheet open={open} onClose={onClose} head={head} foot={<EditFoot changes={count} busy={busy} onSave={() => void save()} />}>
      <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8, gap: 14 }}>
        {BULK_EDIT_FIELDS.map((f) => (
          <View key={f.id} style={{ gap: 14 }}>
            {field(f.id, f.label)}
            {f.id === "series" ? series.list : null}
          </View>
        ))}
      </View>
    </Sheet>
  );
}

/** A card's pick disc while selecting, where the finished check goes. */
export function PickDisc({ on }: { on: boolean }) {
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
        borderWidth: 2,
        alignItems: "center",
        justifyContent: "center",
        // Over the cover art, whatever its colour.
        borderColor: on ? t.accent : "rgba(243,241,236,0.85)",
        backgroundColor: on ? t.accent : "rgba(17,18,20,0.72)",
      }}
    >
      {on ? <CheckIcon size={14} color={t.onAccent} /> : null}
    </View>
  );
}
