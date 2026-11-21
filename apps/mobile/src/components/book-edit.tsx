import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  apiPaths,
  type BookEditInfo,
  BOOK_FIELD_LABELS,
  BOOK_PROVIDER_NAME,
  bookFormOf,
  type BookEditForm,
  changedFields,
  changedRows,
  chapterRowsOf,
  type ChapterRow,
  chapterStartOf,
  duration,
  errorText,
  formatClock,
  formatSize,
  type KnownSeries,
  type MatchSearchResult,
  parseClock,
  plural,
  sameChapterRow,
  scannedText,
  suggestSeries,
} from "@murmur/shared/client";
import { absolute, api, authHeaders } from "@/lib/api";
import { removeBooks } from "@/lib/data";
import { queryClient } from "@/lib/query";
import { fonts, useTheme } from "@/theme";
import { Cover } from "./cover";
import { MinusIcon, PlusIcon, RefreshIcon } from "./icons";
import { SheetHead, useBookMatch } from "./match";
import { PictureEdit, type PictureOption, usePicturePick } from "./picture-edit";
import { RemoveBooksSheet, Sheet } from "./sheet";
import { Bone, Skeleton } from "./skeleton";
import { toast } from "./toast";
import { TextTabs } from "./text-tabs";
import { Button, Caption, EditFoot, IconButton, Input, LinkButton, Text } from "./ui";

// A book's Edit for admins, like the web's: details, cover, chapters, match and files. Details and
// chapters are saved with Save; cover, match and file actions apply at once.

export type BookEditTab = "details" | "cover" | "chapters" | "match" | "files";

const TABS: { id: BookEditTab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "cover", label: "Cover" },
  { id: "chapters", label: "Chapters" },
  { id: "match", label: "Match" },
  { id: "files", label: "Files" },
];

type Act = (fn: () => Promise<BookEditInfo | void>, done: string) => Promise<void>;

/** Edit for one book, opened on `tab`; null keeps it closed. */
export function BookEditSheet({
  bookId,
  title,
  tab,
  onClose,
  onRemoved,
}: {
  bookId: string;
  title: string;
  tab: BookEditTab | null;
  onClose: () => void;
  /** After the book is removed from the library, on top of closing. */
  onRemoved?: () => void;
}) {
  // Each opening starts afresh on the tab it was opened on; the sheet keeps it while it slides away.
  const [state, setState] = useState({ open: false, tab: "details" as BookEditTab, round: 0 });
  if ((tab !== null) !== state.open) setState({ open: tab !== null, tab: tab ?? state.tab, round: tab !== null ? state.round + 1 : state.round });
  if (state.round === 0) return null;
  return <BookEdit key={state.round} bookId={bookId} title={title} startTab={state.tab} open={state.open} onClose={onClose} onRemoved={onRemoved} />;
}

function BookEdit({
  bookId,
  title,
  startTab,
  open,
  onClose,
  onRemoved,
}: {
  bookId: string;
  title: string;
  startTab: BookEditTab;
  open: boolean;
  onClose: () => void;
  onRemoved?: () => void;
}) {
  const [tab, setTab] = useState(startTab);
  const [info, setInfo] = useState<BookEditInfo | null>(null);
  const [form, setForm] = useState<BookEditForm | null>(null);
  const [rows, setRows] = useState<ChapterRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adopt = useCallback((next: BookEditInfo) => {
    setInfo(next);
    setForm(bookFormOf(next));
    setRows(chapterRowsOf(next.book.chapters));
  }, []);
  const load = useCallback(() => api<BookEditInfo>(apiPaths.bookEdit(bookId)), [bookId]);
  useEffect(() => {
    let live = true;
    load().then(
      (next) => live && adopt(next),
      (err: unknown) => live && setError(errorText(err)),
    );
    return () => {
      live = false;
    };
  }, [load, adopt]);

  // Save says how many: changed details, plus chapter rows added, removed or changed.
  const detailChanges = info && form ? changedFields(form, bookFormOf(info)) : 0;
  const chapterChanges = info ? changedRows(rows, chapterRowsOf(info.book.chapters), sameChapterRow) : 0;
  const detailsDirty = detailChanges > 0;
  const chaptersDirty = chapterChanges > 0;

  /** Runs an action that returns fresh edit info (or fetches it), then refreshes the screens behind. */
  const act: Act = async (fn, done) => {
    setBusy(true);
    try {
      adopt((await fn()) ?? (await load()));
      toast.show(done);
      void queryClient.invalidateQueries();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    act(async () => {
      let next: BookEditInfo | undefined;
      if (detailsDirty && form) {
        const position = form.seriesPosition.trim() ? Number(form.seriesPosition) : null;
        if (position !== null && !Number.isFinite(position)) throw new Error("Book number has to be a number, like 2 or 2.5.");
        next = await api<BookEditInfo>(apiPaths.bookDetails(bookId),{ method: "PUT", body: { ...form, seriesPosition: position } });
      }
      if (chaptersDirty) {
        const chapters = rows.map((r, i) => {
          const startSec = chapterStartOf(r);
          if (startSec === null) throw new Error(`Chapter ${i + 1}: start time should look like 1:02:03.`);
          if (!r.title.trim()) throw new Error(`Chapter ${i + 1} needs a name.`);
          return { title: r.title.trim(), startSec };
        });
        next = await api<BookEditInfo>(apiPaths.bookChapters(bookId),{ method: "PUT", body: { chapters } });
      }
      return next;
    }, "Saved");

  // Takes the book out of the library; its files stay where they are.
  const remove = async () => {
    if (!info) return;
    setBusy(true);
    try {
      await removeBooks([info.book]);
      onClose();
      onRemoved?.();
    } catch (err) {
      toast.error(errorText(err));
      setBusy(false);
    }
  };

  const match = useBookMatch(bookId, tab === "match", () => {
    void act(async () => undefined, "Match applied");
    setTab("details");
  });

  const picture = usePicturePick();

  const b = info?.book;
  const head = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Cover path={b?.coverHash ? apiPaths.coverUrl(b.id, b.coverHash, 200) : null} title={b?.title ?? title} color={b?.coverColor} size={48} radius={6} />
      <View style={{ flex: 1 }}>
        <SheetHead
          title="Edit book"
          sub={b ? [b.title, b.author].filter(Boolean).join(", ") : title}
          sub2={b ? `Your files: ${duration(b.durationSec)}${b.asin ? `, ASIN ${b.asin}` : ""}` : undefined}
        />
      </View>
    </View>
  );
  // Save is for details and chapters; Cover and Match each have their own button, once something's picked.
  const foot =
    tab === "match" ? match.foot : tab === "cover" ? picture.foot : tab === "details" || tab === "chapters" ? (
      <EditFoot changes={detailChanges + chapterChanges} busy={busy} onSave={() => void save()} />
    ) : null;

  return (
    <Sheet open={open} onClose={onClose} head={head} foot={foot} tall>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <View style={{ paddingHorizontal: 12 }}>
          <TextTabs
            options={TABS}
            value={tab}
            onPick={(next) => {
              setTab(next);
              picture.setPicked(null);
            }}
            label="Edit"
          />
        </View>
        {tab === "match" ? (
          match.body
        ) : error && !info ? (
          <Text variant="small" style={{ paddingHorizontal: 12 }}>
            {error}
          </Text>
        ) : !info || !form ? (
          <Skeleton style={{ paddingHorizontal: 12, gap: 14 }}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={{ gap: 6 }}>
                <Bone width={80} height={11} />
                <Bone height={48} radius={14} />
              </View>
            ))}
          </Skeleton>
        ) : (
          <View style={{ paddingHorizontal: 12, gap: 14 }}>
            {tab === "details" ? (
              <DetailsTab info={info} form={form} setForm={setForm} />
            ) : tab === "cover" ? (
              <CoverTab info={info} busy={busy} act={act} picked={picture.picked} onPick={picture.setPicked} />
            ) : tab === "chapters" ? (
              <ChaptersTab info={info} rows={rows} setRows={setRows} busy={busy} act={act} />
            ) : (
              <FilesTab info={info} busy={busy} act={act} onRemove={() => void remove()} />
            )}
          </View>
        )}
      </View>
    </Sheet>
  );
}

/**
 * The library's series under a Series field as you type, so books land in the same one. Give the
 * field `inputProps`, call `onType` as it changes, and put `list` under it.
 */
export function useSeriesSuggest(known: KnownSeries[], value: string, onPick: (name: string) => void) {
  const t = useTheme();
  const [suggesting, setSuggesting] = useState(false);
  // A tap on a suggestion can blur the field before the press registers (with a hardware keyboard
  // it does, as the finger goes down), so a blur closes the list a moment later, unless a
  // suggestion is being pressed by then.
  const picking = useRef(false);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeSoon = () => {
    clearTimeout(closing.current);
    closing.current = setTimeout(() => !picking.current && setSuggesting(false), 300);
  };
  const open = () => {
    clearTimeout(closing.current);
    setSuggesting(true);
  };
  useEffect(() => () => clearTimeout(closing.current), []);
  const hits = suggesting ? suggestSeries(known, value).filter((s) => s.name !== value) : [];
  const list = hits.length ? (
    <View style={{ marginTop: -6, borderRadius: 12, backgroundColor: t.surface2, overflow: "hidden" }}>
      {hits.map((s) => (
        <Pressable
          key={s.name}
          accessibilityRole="button"
          onPressIn={() => (picking.current = true)}
          onPressOut={() => {
            picking.current = false;
            closeSoon();
          }}
          onPress={() => {
            picking.current = false;
            clearTimeout(closing.current);
            setSuggesting(false);
            onPick(s.name);
          }}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 44, backgroundColor: pressed ? t.chip : "transparent" })}
        >
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.medium, fontSize: 14, color: t.text }}>
            {s.name}
          </Text>
          <Text variant="small">{plural(s.books, "book")}</Text>
        </Pressable>
      ))}
    </View>
  ) : null;
  return { inputProps: { onFocus: open, onBlur: closeSoon }, onType: open, list };
}

function DetailsTab({ info, form, setForm }: { info: BookEditInfo; form: BookEditForm; setForm: (f: BookEditForm) => void }) {
  const t = useTheme();
  const series = useSeriesSuggest(info.knownSeries, form.series, (name) => setForm({ ...form, series: name }));
  const field =(f: keyof BookEditForm, opts: { multiline?: boolean; placeholder?: string; numeric?: boolean } = {}) => {
    const scanned = scannedText(info.scanned, f);
    const saved = bookFormOf(info)[f];
    const changed = form[f].trim() !== scanned;
    // Unsaved typing can be undone; a saved edit can be reset to what the files say.
    const unsaved = form[f] !== saved;
    return (
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Caption style={{ letterSpacing: 0.6 }}>{BOOK_FIELD_LABELS[f]}</Caption>
          {changed ? <View accessibilityLabel="Edited" style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.accent }} /> : null}
          <View style={{ flex: 1 }} />
          {unsaved ? (
            <LinkButton label="Undo" onPress={() => setForm({ ...form, [f]: saved })} />
          ) : changed ? (
            <LinkButton label="Reset" onPress={() => setForm({ ...form, [f]: scanned })} />
          ) : null}
        </View>
        <Input
          accessibilityLabel={BOOK_FIELD_LABELS[f]}
          value={form[f]}
          placeholder={opts.placeholder}
          onChangeText={(text) => {
            setForm({ ...form, [f]: text });
            if (f === "series") series.onType();
          }}
          keyboardType={opts.numeric ? "decimal-pad" : undefined}
          multiline={opts.multiline}
          {...(f === "series" ? series.inputProps : null)}
          style={opts.multiline ? { height: 160, paddingTop: 12, textAlignVertical: "top" } : undefined}
        />
        {changed && !opts.multiline ? (
          <Text variant="small" numberOfLines={1}>
            {`Files say: ${scanned || "nothing"}`}
          </Text>
        ) : null}
      </View>
    );
  };
  return (
    <>
      {field("title")}
      {field("author")}
      {field("narrator")}
      {field("series", { placeholder: "None" })}
      {series.list}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>{field("seriesPosition", { placeholder: "1", numeric: true })}</View>
        <View style={{ flex: 1 }}>{field("year", { numeric: true })}</View>
      </View>
      {field("description", { multiline: true })}
    </>
  );
}

function CoverTab({
  info,
  busy,
  act,
  picked,
  onPick,
}: {
  info: BookEditInfo;
  busy: boolean;
  act: Act;
  picked: string | null;
  onPick: (o: PictureOption | null) => void;
}) {
  const [suggestions, setSuggestions] = useState<MatchSearchResult | null>(null);
  const book = info.book;

  useEffect(() => {
    let live = true;
    api<MatchSearchResult>(apiPaths.bookMatch(book.id)).then(
      (r) => live && setSuggestions(r),
      () => live && setSuggestions({ query: { title: "", author: null, asin: null }, candidates: [], suggested: null, errors: [] }),
    );
    return () => {
      live = false;
    };
  }, [book.id]);

  const upload = (file: ImagePicker.ImagePickerAsset) => {
    void act(async () => {
      const body = new FormData();
      // React Native's FormData takes a file as its uri, name and type.
      body.append("image", { uri: file.uri, name: file.fileName ?? "cover.jpg", type: file.mimeType ?? "image/jpeg" } as unknown as Blob);
      const res = await fetch(absolute(apiPaths.bookCover(book.id)),{ method: "POST", headers: authHeaders(), body });
      const data = (await res.json().catch(() => null)) as (BookEditInfo & { error?: string }) | null;
      if (!res.ok) throw new Error(data?.error ?? `Upload failed (${res.status}).`);
      return data as BookEditInfo;
    }, "Cover updated");
  };
  const fromUrl = (u: string) => act(() => api<BookEditInfo>(apiPaths.bookCover(book.id), { method: "POST", body: { url: u } }), "Cover updated");
  const covers = suggestions && suggestions.candidates.filter((c) => c.coverUrl).slice(0, 8);

  return (
    <PictureEdit
      path={book.coverHash ? apiPaths.coverUrl(book.id, book.coverHash, 600) : null}
      title={book.title}
      color={book.coverColor}
      source={info.coverSource === "custom" ? "Custom cover" : info.coverSource === "files" ? "From the files" : "No cover yet"}
      reset={
        info.coverSource === "custom"
          ? {
              label: info.scannedCoverHash ? "Use the files' cover" : "Remove this cover",
              onPress: () => void act(() => api<BookEditInfo>(apiPaths.bookCover(book.id), { method: "DELETE" }), "Using the files' cover"),
            }
          : undefined
      }
      busy={busy}
      onUpload={upload}
      onLink={fromUrl}
      options={
        covers?.map((c) => ({
          key: `${c.provider}:${c.providerId}`,
          thumb: c.coverUrl!,
          label: `Pick the ${BOOK_PROVIDER_NAME[c.provider]} cover of ${c.title}`,
          caption: BOOK_PROVIDER_NAME[c.provider],
          apply: () => fromUrl(c.coverUrl!),
        })) ?? null
      }
      emptyText="No covers found online."
      picked={picked}
      onPick={onPick}
    />
  );
}

function ChaptersTab({ info, rows, setRows, busy, act }: { info: BookEditInfo; rows: ChapterRow[]; setRows: (r: ChapterRow[]) => void; busy: boolean; act: Act }) {
  const t = useTheme();
  const set = (i: number, patch: Partial<ChapterRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <>
      <Text variant="small">{info.chaptersEdited ? "Edited or matched chapters." : `${info.scannedChapters.length} chapters from the files.`}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button label="Number them" kind="secondary" onPress={() => setRows(rows.map((r, i) => ({ ...r, title: `Chapter ${i + 1}` })))} style={{ height: 40, paddingHorizontal: 16 }} />
        {info.chaptersEdited ? (
          <Button
            label="Use the files' chapters"
            kind="secondary"
            disabled={busy}
            onPress={() => void act(() => api<BookEditInfo>(apiPaths.bookChapters(info.book.id),{ method: "PUT", body: { chapters: null } }), "Using the files' chapters")}
            style={{ height: 40, paddingHorizontal: 16 }}
          />
        ) : null}
      </View>
      {rows.map((r, i) => {
        const bad = i > 0 && parseClock(r.start) === null;
        return (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text variant="small" style={{ width: 22, textAlign: "right", fontVariant: ["tabular-nums"] }}>
              {i + 1}
            </Text>
            <Input value={r.title} accessibilityLabel={`Chapter ${i + 1} name`} onChangeText={(title) => set(i, { title })} style={{ flex: 1, minHeight: 44 }} />
            <Input
              value={i === 0 ? "0:00:00" : r.start}
              editable={i > 0}
              accessibilityLabel={`Chapter ${i + 1} start`}
              keyboardType="numbers-and-punctuation"
              onChangeText={(start) => set(i, { start })}
              style={{ width: 92, minHeight: 44, paddingHorizontal: 10, fontVariant: ["tabular-nums"], color: i === 0 ? t.faint : bad ? t.danger : t.text }}
            />
            <IconButton label={`Remove chapter ${i + 1}`} disabled={rows.length === 1} onPress={() => setRows(rows.filter((_, j) => j !== i))} style={{ width: 36, opacity: rows.length === 1 ? 0.4 : 1 }}>
              <MinusIcon size={18} color={t.muted} />
            </IconButton>
          </View>
        );
      })}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          const last = rows.at(-1);
          const lastStart = last ? (parseClock(last.start) ?? 0) : 0;
          const start = Math.min(info.book.durationSec - 1, lastStart + 600);
          setRows([...rows, { title: `Chapter ${rows.length + 1}`, start: formatClock(start) }]);
        }}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}
      >
        <PlusIcon size={18} color={t.accent} />
        <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: t.accent }}>Add chapter</Text>
      </Pressable>
    </>
  );
}

function FilesTab({ info, busy, act, onRemove }: { info: BookEditInfo; busy: boolean; act: Act; onRemove: () => void }) {
  const t = useTheme();
  const [confirm, setConfirm] = useState<null | "undo">(null);
  const [asking, setAsking] = useState(false);
  const missing = info.book.missingSince !== null;
  const hasEdits = info.edited.length > 0 || info.chaptersEdited || info.coverSource === "custom" || !!info.book.match;
  const mono = { fontFamily: fonts.medium, fontSize: 13, color: t.text } as const;
  const dangerLink = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ alignSelf: "center", paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: t.danger }}>{label}</Text>
    </Pressable>
  );
  return (
    <>
      <View style={{ gap: 6 }}>
        <Caption style={{ letterSpacing: 0.6 }}>Folder</Caption>
        <Text style={mono}>{info.folder ?? "Its library folder was removed."}</Text>
        {missing ? (
          <Text variant="small" style={{ color: t.danger }}>
            These files are missing.
          </Text>
        ) : null}
      </View>
      <View>
        {info.files.map((f) => (
          <View key={f.name} style={{ paddingVertical: 10, gap: 2, borderBottomWidth: 1, borderBottomColor: t.line }}>
            <Text style={mono}>{f.name}</Text>
            <Text variant="small">
              {`${duration(f.durationSec)}, ${formatSize(f.size)}${f.durationSec > 0 ? `, ${Math.round((f.size * 8) / f.durationSec / 1000)} kbps` : ""}`}
            </Text>
          </View>
        ))}
      </View>
      <RemoveBooksSheet open={asking} books={[info.book]} onConfirm={onRemove} onClose={() => setAsking(false)} />
      {confirm === "undo" ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button label="Keep edits" kind="secondary" onPress={() => setConfirm(null)} style={{ flex: 1, paddingHorizontal: 12 }} />
          <Button
            label="Undo every edit and match"
            disabled={busy}
            onPress={() =>
              void act(async () => {
                await api(apiPaths.bookMatch(info.book.id),{ method: "DELETE" });
                setConfirm(null);
              }, "Back to the files' details")
            }
            style={{ flex: 1, paddingHorizontal: 12, backgroundColor: t.danger }}
          />
        </View>
      ) : (
        <>
          <Button
            label="Rescan files"
            kind="secondary"
            icon={<RefreshIcon size={18} color={t.text} />}
            disabled={busy}
            onPress={() =>
              void act(async () => {
                await api(apiPaths.bookRescan(info.book.id),{ method: "POST" });
              }, "Rescanning. Changes show in a moment.")
            }
          />
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 28 }}>
            {hasEdits && !missing ? dangerLink("Undo all edits", () => setConfirm("undo")) : null}
            {dangerLink("Remove from library…", () => setAsking(true))}
          </View>
        </>
      )}
    </>
  );
}
