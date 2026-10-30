import { useCallback, useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  apiPaths,
  type BookEditInfo,
  type BookEditValues,
  type ChapterDto,
  duration,
  errorText,
  type MatchSearchResult,
  plural,
  suggestSeries,
} from "@murmur/shared/client";
import { absolute, api, authHeaders } from "@/lib/api";
import { queryClient } from "@/lib/query";
import { fonts, useTheme } from "@/theme";
import { Cover } from "./cover";
import { MinusIcon, PlusIcon } from "./icons";
import { PROVIDER_NAME, SheetHead, useBookMatch } from "./match";
import { Sheet } from "./sheet";
import { Bone, Skeleton } from "./skeleton";
import { toast } from "./toast";
import { Button, Caption, Chips, IconButton, Text } from "./ui";

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

interface Form {
  title: string;
  author: string;
  narrator: string;
  series: string;
  seriesPosition: string;
  year: string;
  description: string;
}

const FIELD_LABELS: Record<keyof Form, string> = {
  title: "Title",
  author: "Author",
  narrator: "Narrator",
  series: "Series",
  seriesPosition: "Book number",
  year: "Year",
  description: "Description",
};

function formOf(info: BookEditInfo): Form {
  const b = info.book;
  return {
    title: b.title,
    author: b.author ?? "",
    narrator: b.narrator ?? "",
    series: b.series ?? "",
    seriesPosition: b.seriesPosition === null ? "" : String(b.seriesPosition),
    year: b.year ?? "",
    description: b.description ?? "",
  };
}

function scannedText(s: BookEditValues, f: keyof Form): string {
  if (f === "seriesPosition") return s.seriesPosition === null ? "" : String(s.seriesPosition);
  return s[f] ?? "";
}

/** "1:02:03", "62:03" or "3723" to seconds; null when it can't be read. */
function parseClock(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((sum, p) => sum * 60 + Number(p), 0);
}

function formatClock(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** `sec` is the exact original start, kept when the shown (rounded) time isn't changed. */
type Row = { title: string; start: string; sec?: number };
const rowsOf = (chapters: ChapterDto[]): Row[] => chapters.map((c) => ({ title: c.title, start: formatClock(c.startSec), sec: c.startSec }));
const startOf = (r: Row) => (r.sec !== undefined && r.start === formatClock(r.sec) ? r.sec : parseClock(r.start));
const sameRows = (a: Row[], b: Row[]) => a.length === b.length && a.every((r, i) => r.title === b[i]!.title && r.start === b[i]!.start);

type Act = (fn: () => Promise<BookEditInfo | void>, done: string) => Promise<void>;

/** Edit for one book, opened on `tab`; null keeps it closed. */
export function BookEditSheet({ bookId, title, tab, onClose }: { bookId: string; title: string; tab: BookEditTab | null; onClose: () => void }) {
  // Each opening starts afresh on the tab it was opened on; the sheet keeps it while it slides away.
  const [state, setState] = useState({ open: false, tab: "details" as BookEditTab, round: 0 });
  if ((tab !== null) !== state.open) setState({ open: tab !== null, tab: tab ?? state.tab, round: tab !== null ? state.round + 1 : state.round });
  if (state.round === 0) return null;
  return <BookEdit key={state.round} bookId={bookId} title={title} startTab={state.tab} open={state.open} onClose={onClose} />;
}

function BookEdit({ bookId, title, startTab, open, onClose }: { bookId: string; title: string; startTab: BookEditTab; open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState(startTab);
  const [info, setInfo] = useState<BookEditInfo | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adopt = useCallback((next: BookEditInfo) => {
    setInfo(next);
    setForm(formOf(next));
    setRows(rowsOf(next.book.chapters));
  }, []);
  const load = useCallback(() => api<BookEditInfo>(`/api/books/${bookId}/edit`), [bookId]);
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

  const detailsDirty = !!(info && form && JSON.stringify(form) !== JSON.stringify(formOf(info)));
  const chaptersDirty = !!(info && !sameRows(rows, rowsOf(info.book.chapters)));

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
        next = await api<BookEditInfo>(`/api/books/${bookId}/details`, { method: "PUT", body: { ...form, seriesPosition: position } });
      }
      if (chaptersDirty) {
        const chapters = rows.map((r, i) => {
          const startSec = startOf(r);
          if (startSec === null) throw new Error(`Chapter ${i + 1}: start time should look like 1:02:03.`);
          if (!r.title.trim()) throw new Error(`Chapter ${i + 1} needs a name.`);
          return { title: r.title.trim(), startSec };
        });
        next = await api<BookEditInfo>(`/api/books/${bookId}/chapters`, { method: "PUT", body: { chapters } });
      }
      return next;
    }, "Saved");

  const match = useBookMatch(bookId, tab === "match", () => {
    void act(async () => undefined, "Match applied");
    setTab("details");
  });

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
  const foot =
    tab === "match" ? match.foot : tab === "details" || tab === "chapters" ? (
      <Button label="Save" busy={busy} disabled={!(detailsDirty || chaptersDirty)} onPress={() => void save()} />
    ) : null;

  return (
    <Sheet open={open} onClose={onClose} head={head} foot={foot} tall>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <View style={{ paddingHorizontal: 12 }}>
          <Chips options={TABS} value={tab} onPick={setTab} label="Edit" wrap />
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
              <CoverTab info={info} busy={busy} act={act} />
            ) : tab === "chapters" ? (
              <ChaptersTab info={info} rows={rows} setRows={setRows} busy={busy} act={act} />
            ) : (
              <FilesTab info={info} busy={busy} act={act} />
            )}
          </View>
        )}
      </View>
    </Sheet>
  );
}

function Input({ style, onFocus, onBlur, ...rest }: React.ComponentProps<typeof TextInput>) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={t.faint}
      selectionColor={t.accent}
      // Android shows the end of long text; until you tap in, show its start.
      selection={focused ? undefined : { start: 0 }}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      {...rest}
      style={[{ minHeight: 48, borderRadius: 14, paddingHorizontal: 14, backgroundColor: t.surface2, color: t.text, fontFamily: fonts.medium, fontSize: 15 }, style]}
    />
  );
}

function LinkButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" hitSlop={8} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.6 : 1 })}>
      <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: t.accent }}>{label}</Text>
    </Pressable>
  );
}

function DetailsTab({ info, form, setForm }: { info: BookEditInfo; form: Form; setForm: (f: Form) => void }) {
  const t = useTheme();
  const [seriesFocused, setSeriesFocused] = useState(false);
  const field = (f: keyof Form, opts: { multiline?: boolean; placeholder?: string; numeric?: boolean } = {}) => {
    const scanned = scannedText(info.scanned, f);
    const saved = formOf(info)[f];
    const changed = form[f].trim() !== scanned;
    // Unsaved typing can be undone; a saved edit can be reset to what the files say.
    const unsaved = form[f] !== saved;
    return (
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Caption style={{ letterSpacing: 0.6 }}>{FIELD_LABELS[f]}</Caption>
          {changed ? <View accessibilityLabel="Edited" style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.accent }} /> : null}
          <View style={{ flex: 1 }} />
          {unsaved ? (
            <LinkButton label="Undo" onPress={() => setForm({ ...form, [f]: saved })} />
          ) : changed ? (
            <LinkButton label="Reset" onPress={() => setForm({ ...form, [f]: scanned })} />
          ) : null}
        </View>
        <Input
          accessibilityLabel={FIELD_LABELS[f]}
          value={form[f]}
          placeholder={opts.placeholder}
          onChangeText={(text) => setForm({ ...form, [f]: text })}
          keyboardType={opts.numeric ? "decimal-pad" : undefined}
          multiline={opts.multiline}
          onFocus={f === "series" ? () => setSeriesFocused(true) : undefined}
          onBlur={f === "series" ? () => setSeriesFocused(false) : undefined}
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
  // The library's series as you type, so books land in the same one.
  const hits = seriesFocused ? suggestSeries(info.knownSeries, form.series).filter((s) => s.name !== form.series) : [];
  return (
    <>
      {field("title")}
      {field("author")}
      {field("narrator")}
      {field("series", { placeholder: "None" })}
      {hits.length ? (
        <View style={{ marginTop: -6, borderRadius: 12, backgroundColor: t.surface2, overflow: "hidden" }}>
          {hits.map((s) => (
            <Pressable
              key={s.name}
              accessibilityRole="button"
              onPress={() => setForm({ ...form, series: s.name })}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 44, backgroundColor: pressed ? t.chip : "transparent" })}
            >
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.medium, fontSize: 14, color: t.text }}>
                {s.name}
              </Text>
              <Text variant="small">{plural(s.books, "book")}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>{field("seriesPosition", { placeholder: "1", numeric: true })}</View>
        <View style={{ flex: 1 }}>{field("year", { numeric: true })}</View>
      </View>
      {field("description", { multiline: true })}
    </>
  );
}

function CoverTab({ info, busy, act }: { info: BookEditInfo; busy: boolean; act: Act }) {
  const [url, setUrl] = useState("");
  const [suggestions, setSuggestions] = useState<MatchSearchResult | null>(null);
  const book = info.book;

  useEffect(() => {
    let live = true;
    api<MatchSearchResult>(`/api/books/${book.id}/match`).then(
      (r) => live && setSuggestions(r),
      () => live && setSuggestions({ query: { title: "", author: null, asin: null }, candidates: [], suggested: null, errors: [] }),
    );
    return () => {
      live = false;
    };
  }, [book.id]);

  const choose = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    const file = picked.canceled ? null : picked.assets[0];
    if (!file) return;
    void act(async () => {
      const body = new FormData();
      // React Native's FormData takes a file as its uri, name and type.
      body.append("image", { uri: file.uri, name: file.fileName ?? "cover.jpg", type: file.mimeType ?? "image/jpeg" } as unknown as Blob);
      const res = await fetch(absolute(`/api/books/${book.id}/cover`), { method: "POST", headers: authHeaders(), body });
      const data = (await res.json().catch(() => null)) as (BookEditInfo & { error?: string }) | null;
      if (!res.ok) throw new Error(data?.error ?? `Upload failed (${res.status}).`);
      return data as BookEditInfo;
    }, "Cover updated");
  };
  const fromUrl = (u: string) => act(() => api<BookEditInfo>(`/api/books/${book.id}/cover`, { method: "POST", body: { url: u } }), "Cover updated");
  const covers = (suggestions?.candidates ?? []).filter((c) => c.coverUrl).slice(0, 8);
  const thumb = { flexBasis: "22%" as const, flexGrow: 0, gap: 4 };

  return (
    <>
      <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-end" }}>
        <Cover path={book.coverHash ? apiPaths.coverUrl(book.id, book.coverHash, 600) : null} title={book.title} color={book.coverColor} size={140} radius={10} />
        <View style={{ flex: 1, gap: 10 }}>
          <Text variant="small">{info.coverSource === "custom" ? "Custom cover" : info.coverSource === "files" ? "From the files" : "No cover yet"}</Text>
          {info.coverSource === "custom" ? (
            <Button
              label={info.scannedCoverHash ? "Use the files' cover" : "Remove custom cover"}
              kind="secondary"
              disabled={busy}
              onPress={() => void act(() => api<BookEditInfo>(`/api/books/${book.id}/cover`, { method: "DELETE" }), "Using the files' cover")}
              style={{ paddingHorizontal: 16 }}
            />
          ) : null}
        </View>
      </View>
      <Button label="Choose an image" kind="secondary" disabled={busy} onPress={() => void choose()} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Input value={url} onChangeText={setUrl} placeholder="Or paste an image link" accessibilityLabel="Image link" keyboardType="url" autoCapitalize="none" autoCorrect={false} style={{ flex: 1 }} />
        <Button
          label="Use link"
          kind="secondary"
          disabled={busy || !url.trim()}
          onPress={() => void fromUrl(url.trim()).then(() => setUrl(""))}
          style={{ height: 48, paddingHorizontal: 18 }}
        />
      </View>
      <Text variant="bodyStrong" style={{ fontSize: 14 }}>
        Suggestions
      </Text>
      {suggestions === null ? (
        <Skeleton style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={thumb}>
              <Bone height={72} radius={8} />
            </View>
          ))}
        </Skeleton>
      ) : covers.length === 0 ? (
        <Text variant="small">No covers found online.</Text>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {covers.map((c) => (
            <Pressable
              key={`${c.provider}:${c.providerId}`}
              accessibilityRole="button"
              accessibilityLabel={`Use the ${PROVIDER_NAME[c.provider]} cover of ${c.title}`}
              disabled={busy}
              onPress={() => void fromUrl(c.coverUrl!)}
              style={({ pressed }) => [thumb, { opacity: pressed || busy ? 0.6 : 1 }]}
            >
              <Cover path={c.coverUrl} title={c.title} radius={8} />
              <Text variant="small" numberOfLines={1} style={{ fontSize: 11 }}>
                {PROVIDER_NAME[c.provider]}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </>
  );
}

function ChaptersTab({ info, rows, setRows, busy, act }: { info: BookEditInfo; rows: Row[]; setRows: (r: Row[]) => void; busy: boolean; act: Act }) {
  const t = useTheme();
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
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
            onPress={() => void act(() => api<BookEditInfo>(`/api/books/${info.book.id}/chapters`, { method: "PUT", body: { chapters: null } }), "Using the files' chapters")}
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

function FilesTab({ info, busy, act }: { info: BookEditInfo; busy: boolean; act: Act }) {
  const t = useTheme();
  const [confirmUndo, setConfirmUndo] = useState(false);
  const hasEdits = info.edited.length > 0 || info.chaptersEdited || info.coverSource === "custom" || !!info.book.match;
  const mono = { fontFamily: fonts.medium, fontSize: 13, color: t.text } as const;
  return (
    <>
      <View style={{ gap: 6 }}>
        <Caption style={{ letterSpacing: 0.6 }}>Folder</Caption>
        <Text style={mono}>{info.folder ?? "Its library folder was removed."}</Text>
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
      <Button
        label="Rescan files"
        kind="secondary"
        disabled={busy}
        onPress={() =>
          void act(async () => {
            await api(`/api/books/${info.book.id}/rescan`, { method: "POST" });
          }, "Rescanning. Changes show in a moment.")
        }
      />
      {hasEdits ? (
        confirmUndo ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button label="Keep edits" kind="secondary" onPress={() => setConfirmUndo(false)} style={{ flex: 1, paddingHorizontal: 12 }} />
            <Button
              label="Undo every edit"
              disabled={busy}
              onPress={() =>
                void act(async () => {
                  await api(`/api/books/${info.book.id}/match`, { method: "DELETE" });
                  setConfirmUndo(false);
                }, "Back to the files' details")
              }
              style={{ flex: 1, paddingHorizontal: 12, backgroundColor: t.danger }}
            />
          </View>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setConfirmUndo(true)} style={({ pressed }) => ({ alignSelf: "center", paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: t.danger }}>Undo all edits</Text>
          </Pressable>
        )
      ) : null}
    </>
  );
}
