import { useCallback, useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import {
  ALBUM_PROVIDER_NAME,
  type AlbumMatchField,
  type AlbumMatchPreview,
  type AlbumMatchSearch,
  type AlbumMatchValues,
  type ArtistPhotoOption,
  duration,
  errorText,
  type MatchField,
  type MatchPreview,
  type MatchSearchResult,
  type MatchValues,
  plural,
  seriesLabel,
} from "@murmur/shared/client";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";
import { getJson, setJson } from "@/lib/storage";
import { fonts, useTheme } from "@/theme";
import { Cover } from "./cover";
import { BackIcon, CheckIcon, SearchIcon } from "./icons";
import { Sheet } from "./sheet";
import { Bone, Skeleton } from "./skeleton";
import { toast } from "./toast";
import { Button, IconButton, Pills, Text } from "./ui";

// Match for admins, like the web's: search, pick a result, review what it changes field by field,
// and apply. Books and albums work the same way; an artist's photo is picked straight from a list.

export const PROVIDER_NAME = { audible: "Audible", google: "Google Books", itunes: "Apple Books" } as const;

export const BOOK_FIELDS: { field: MatchField; label: string; text: (v: MatchValues) => string | null }[] = [
  { field: "cover", label: "Cover", text: (v) => v.coverUrl },
  { field: "title", label: "Title", text: (v) => v.title },
  { field: "author", label: "Author", text: (v) => v.author },
  { field: "narrator", label: "Narrator", text: (v) => v.narrator },
  { field: "series", label: "Series", text: (v) => seriesLabel(v.series, v.seriesPosition) },
  { field: "year", label: "Year", text: (v) => v.year },
  { field: "description", label: "Description", text: (v) => v.description },
  { field: "chapters", label: "Chapters", text: (v) => (v.chapterCount ? `${v.chapterCount} chapters` : null) },
];

const songsText = (v: AlbumMatchValues) => v.songs.map((s) => `${s.number ?? "–"}  ${s.title.trim()}`).join("\n");

export const ALBUM_FIELDS: { field: AlbumMatchField; label: string; text: (v: AlbumMatchValues) => string | null }[] = [
  { field: "cover", label: "Cover", text: (v) => v.coverUrl },
  { field: "title", label: "Title", text: (v) => v.title },
  { field: "year", label: "Year", text: (v) => v.year },
  { field: "genre", label: "Genre", text: (v) => v.genre },
  { field: "tracks", label: "Songs", text: (v) => (v.songs.length ? songsText(v) : null) },
];

// The fields last applied, ticked again at the next review; the same keys as the web's.
const BOOK_FIELDS_KEY = "murmur.matchFields";
const ALBUM_FIELDS_KEY = "murmur.albumMatchFields";

function lastOf<F extends string>(key: string, known: { field: F }[]): F[] | null {
  const raw = getJson<unknown>(key);
  return Array.isArray(raw) ? raw.filter((f): f is F => known.some((x) => x.field === f)) : null;
}
export const lastBookFields = () => lastOf(BOOK_FIELDS_KEY, BOOK_FIELDS);
export const lastAlbumFields = () => lastOf(ALBUM_FIELDS_KEY, ALBUM_FIELDS);

// Only stray spaces at the ends are ignored: a change of case or spelling is worth applying.
const norm = (s: string | null) => (s ?? "").trim();

/** Already the result's value. Covers and chapter lists can't be told apart from here, so they never are. */
function sameAs<F extends string, V>(fields: { field: F; text: (v: V) => string | null }[], current: V, proposed: V, field: F) {
  if (field === "cover" || field === "chapters") return false;
  const text = fields.find((f) => f.field === field)!.text;
  return !!text(proposed) && norm(text(current)) === norm(text(proposed));
}

const keyOf = (c: { provider: string; providerId: string }) => `${c.provider}:${c.providerId}`;

/** Keeps a sheet's subject while it slides away, and counts each opening so its state starts afresh. */
function useOpening<T>(value: T | null) {
  const open = value !== null;
  const [state, setState] = useState({ open, shown: value, round: 0 });
  if (open !== state.open || (open && value !== state.shown)) {
    setState({ open, shown: open ? value : state.shown, round: open && !state.open ? state.round + 1 : state.round });
  }
  return { open, shown: state.shown, round: state.round };
}

// ---------- Books ----------

/**
 * Match for one book, the Match tab of its Edit: what to show in the sheet and its foot. It
 * starts searching for the book's title and author the first time the tab is shown.
 */
export function useBookMatch(bookId: string, shown: boolean, onApplied: () => void) {
  // Once shown, it stays started, so switching tabs doesn't drop a search on its way.
  const [started, setStarted] = useState(shown);
  if (shown && !started) setStarted(true);
  const [result, setResult] = useState<MatchSearchResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<MatchPreview | null>(null);
  const [chosen, setChosen] = useState<Set<MatchField>>(new Set());
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState(false);

  const show = useCallback((r: MatchSearchResult, custom: boolean) => {
    setResult(r);
    setSelected(r.suggested);
    for (const e of r.errors) toast.error(e);
    if (!custom) {
      setTitle(r.query.title);
      setAuthor(r.query.author ?? "");
    }
  }, []);
  const failed = useCallback((err: unknown) => {
    toast.error(errorText(err));
    setResult((r) => r ?? { query: { title: "", author: null, asin: null }, candidates: [], suggested: null, errors: [] });
  }, []);
  // The first search is for what the book has; later ones are for what's typed.
  useEffect(() => {
    if (!started) return;
    let live = true;
    api<MatchSearchResult>(`/api/books/${bookId}/match`).then(
      (r) => live && show(r, false),
      (err: unknown) => live && failed(err),
    );
    return () => {
      live = false;
    };
  }, [started, bookId, show, failed]);
  const search = async (custom: { title: string; author: string }) => {
    setBusy(true);
    try {
      show(await api<MatchSearchResult>(`/api/books/${bookId}/match?${new URLSearchParams(custom)}`), true);
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const review = async () => {
    const c = result?.candidates.find((x) => keyOf(x) === selected);
    if (!c) return;
    setBusy(true);
    try {
      const p = await api<MatchPreview>(`/api/books/${bookId}/match/preview?${new URLSearchParams({ provider: c.provider, providerId: c.providerId })}`);
      setPreview(p);
      setChosen(new Set(lastBookFields() ?? p.recommended));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const blocked = (p: MatchPreview, f: MatchField) => (f === "chapters" ? p.chaptersNote : null);
  const can = (p: MatchPreview, f: MatchField) =>
    !!BOOK_FIELDS.find((x) => x.field === f)?.text(p.proposed) && !blocked(p, f) && !sameAs(BOOK_FIELDS, p.current, p.proposed, f);
  // A remembered field this result has no value for stays unticked and isn't sent.
  const fields = preview ? [...chosen].filter((f) => can(preview, f)) : [];

  const apply = async () => {
    if (!preview || fields.length === 0) return;
    setBusy(true);
    try {
      await api(`/api/books/${bookId}/match`, { method: "POST", body: { provider: preview.provider, providerId: preview.providerId, fields } });
      setJson(BOOK_FIELDS_KEY, [...chosen]);
      toast.show("Match applied");
      void queryClient.invalidateQueries();
      setPreview(null);
      onApplied();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const candidates = result?.candidates ?? [];
  const foot = preview ? (
    <ApplyButton count={fields.length} busy={busy} onPress={() => void apply()} />
  ) : candidates.length ? (
    <ResultsFoot count={candidates.length} picked={!!selected} busy={busy} onPress={() => void review()} />
  ) : null;
  const body = (
    <>
      {preview ? (
        <>
          <View style={{ paddingHorizontal: 12 }}>
            <ReviewHead from={PROVIDER_NAME[preview.provider]} onBack={() => setPreview(null)} />
          </View>
          <ReviewList
          fields={BOOK_FIELDS}
          current={preview.current}
          proposed={preview.proposed}
          chosen={chosen}
          setChosen={setChosen}
          can={(f) => can(preview, f)}
          same={(f) => sameAs(BOOK_FIELDS, preview.current, preview.proposed, f)}
          note={(f) => blocked(preview, f)}
          />
        </>
      ) : (
        <View style={{ paddingHorizontal: 12, gap: 10, paddingBottom: 8 }}>
          <SearchInput value={title} onChange={setTitle} placeholder="Title" label="Search title" icon onSubmit={() => title.trim() && void search({ title, author })} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <SearchInput value={author} onChange={setAuthor} placeholder="Author" label="Search author" onSubmit={() => title.trim() && void search({ title, author })} />
            <SearchButton disabled={busy || !title.trim()} onPress={() => void search({ title, author })} />
          </View>
          {result === null ? (
            <ResultBones />
          ) : candidates.length === 0 ? (
            <NoResults />
          ) : (
            candidates.map((c) => {
              const k = keyOf(c);
              const on = selected === k;
              return (
                <ResultCard
                  key={k}
                  selected={on}
                  onPress={() => setSelected(on ? null : k)}
                  art={c.coverUrl}
                  title={c.subtitle ? `${c.title}: ${c.subtitle}` : c.title}
                  sub={[c.author, c.narrator ? `read by ${c.narrator}` : null].filter(Boolean).join(", ")}
                  tags={[seriesLabel(c.series, c.seriesPosition), c.durationSec ? duration(c.durationSec) : null, c.year, PROVIDER_NAME[c.provider]]}
                  reasons={on ? c.reasons : undefined}
                  score={c.score}
                />
              );
            })
          )}
        </View>
      )}
    </>
  );
  return { body, foot };
}

// ---------- Albums ----------

type AlbumRef = { id: string; title: string; artist: string; trackCount: number };

/** Match metadata for one album: its cover, title, year, genre and songs' titles. */
export function AlbumMatchSheet({ album, onClose }: { album: AlbumRef | null; onClose: () => void }) {
  const { open, shown, round } = useOpening(album);
  return shown ? <AlbumMatch key={round} album={shown} open={open} onClose={onClose} /> : null;
}

function AlbumMatch({ album, open, onClose }: { album: AlbumRef; open: boolean; onClose: () => void }) {
  const [result, setResult] = useState<AlbumMatchSearch | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<AlbumMatchPreview | null>(null);
  const [chosen, setChosen] = useState<Set<AlbumMatchField>>(new Set());
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [busy, setBusy] = useState(false);

  const show = useCallback((r: AlbumMatchSearch, custom: boolean) => {
    setResult(r);
    setSelected(r.suggested);
    for (const e of r.errors) toast.error(e);
    if (!custom) {
      setTitle(r.query.title);
      setArtist(r.query.artist);
    }
  }, []);
  const failed = useCallback((err: unknown) => {
    toast.error(errorText(err));
    setResult((r) => r ?? { query: { title: "", artist: "" }, candidates: [], suggested: null, errors: [] });
  }, []);
  // The first search is for what the album has; later ones are for what's typed.
  useEffect(() => {
    let live = true;
    api<AlbumMatchSearch>(`/api/music/albums/${album.id}/match`).then(
      (r) => live && show(r, false),
      (err: unknown) => live && failed(err),
    );
    return () => {
      live = false;
    };
  }, [album.id, show, failed]);
  const search = async (custom: { title: string; artist: string }) => {
    setBusy(true);
    try {
      show(await api<AlbumMatchSearch>(`/api/music/albums/${album.id}/match?${new URLSearchParams(custom)}`), true);
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const review = async () => {
    const c = result?.candidates.find((x) => keyOf(x) === selected);
    if (!c) return;
    setBusy(true);
    try {
      const p = await api<AlbumMatchPreview>(
        `/api/music/albums/${album.id}/match/preview?${new URLSearchParams({ provider: c.provider, providerId: c.providerId })}`,
      );
      setPreview(p);
      setChosen(new Set(lastAlbumFields() ?? p.recommended));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const blocked = (p: AlbumMatchPreview, f: AlbumMatchField) => (f === "tracks" ? p.songsNote : null);
  const same = (p: AlbumMatchPreview, f: AlbumMatchField) =>
    f === "tracks" ? p.proposed.songs.length > 0 && songsText(p.current) === songsText(p.proposed) : sameAs(ALBUM_FIELDS, p.current, p.proposed, f);
  const can = (p: AlbumMatchPreview, f: AlbumMatchField) => !!ALBUM_FIELDS.find((x) => x.field === f)?.text(p.proposed) && !blocked(p, f) && !same(p, f);
  const fields = preview ? [...chosen].filter((f) => can(preview, f)) : [];

  const apply = async () => {
    if (!preview || fields.length === 0) return;
    setBusy(true);
    try {
      await api(`/api/music/albums/${album.id}/match`, { method: "POST", body: { provider: preview.provider, providerId: preview.providerId, fields } });
      setJson(ALBUM_FIELDS_KEY, [...chosen]);
      toast.show("Match applied");
      void queryClient.invalidateQueries();
      onClose();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const candidates = result?.candidates ?? [];
  return (
    <Sheet
      open={open}
      onClose={onClose}
      head={
        preview ? (
          <ReviewHead from={ALBUM_PROVIDER_NAME[preview.provider]} onBack={() => setPreview(null)} />
        ) : (
          <SheetHead title="Match album" sub={`${album.title}, ${album.artist}`} sub2={`Your files: ${plural(album.trackCount, "song")}`} />
        )
      }
      foot={
        preview ? (
          <ApplyButton count={fields.length} busy={busy} onPress={() => void apply()} />
        ) : candidates.length ? (
          <ResultsFoot count={candidates.length} picked={!!selected} busy={busy} onPress={() => void review()} />
        ) : null
      }
    >
      {preview ? (
        <ReviewList
          fields={ALBUM_FIELDS}
          current={preview.current}
          proposed={preview.proposed}
          chosen={chosen}
          setChosen={setChosen}
          can={(f) => can(preview, f)}
          same={(f) => same(preview, f)}
          note={(f) => blocked(preview, f)}
        />
      ) : (
        <View style={{ paddingHorizontal: 12, gap: 10, paddingBottom: 8 }}>
          <SearchInput value={title} onChange={setTitle} placeholder="Album" label="Search album" icon onSubmit={() => title.trim() && void search({ title, artist })} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <SearchInput value={artist} onChange={setArtist} placeholder="Artist" label="Search artist" onSubmit={() => title.trim() && void search({ title, artist })} />
            <SearchButton disabled={busy || !title.trim()} onPress={() => void search({ title, artist })} />
          </View>
          {result === null ? (
            <ResultBones />
          ) : candidates.length === 0 ? (
            <NoResults />
          ) : (
            candidates.map((c) => {
              const k = keyOf(c);
              const on = selected === k;
              return (
                <ResultCard
                  key={k}
                  selected={on}
                  onPress={() => setSelected(on ? null : k)}
                  art={c.thumbUrl}
                  title={c.title}
                  sub={c.artist}
                  tags={[c.trackCount ? plural(c.trackCount, "song") : null, c.year, c.genre, ALBUM_PROVIDER_NAME[c.provider]]}
                  reasons={on ? c.reasons : undefined}
                  score={c.score}
                />
              );
            })
          )}
        </View>
      )}
    </Sheet>
  );
}

// ---------- Artists ----------

type ArtistRef = { id: string; name: string };

/** Pick an artist's photo from the ones found online, or use their newest album's cover. */
export function ArtistPhotoSheet({ artist, onClose }: { artist: ArtistRef | null; onClose: () => void }) {
  const { open, shown, round } = useOpening(artist);
  return shown ? <ArtistPhoto key={round} artist={shown} open={open} onClose={onClose} /> : null;
}

function ArtistPhoto({ artist, open, onClose }: { artist: ArtistRef; open: boolean; onClose: () => void }) {
  const [options, setOptions] = useState<ArtistPhotoOption[] | null>(null);
  const [query, setQuery] = useState(artist.name);
  const [busy, setBusy] = useState(false);

  const url = `/api/music/artists/${artist.id}/photo/options`;
  useEffect(() => {
    let live = true;
    api<ArtistPhotoOption[]>(url).then(
      (o) => live && setOptions(o),
      (err: unknown) => {
        if (!live) return;
        toast.error(errorText(err));
        setOptions([]);
      },
    );
    return () => {
      live = false;
    };
  }, [url]);
  const search = async (q: string) => {
    setBusy(true);
    try {
      setOptions(await api<ArtistPhotoOption[]>(`${url}?${new URLSearchParams({ q })}`));
    } catch (err) {
      toast.error(errorText(err));
      setOptions([]);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (providerId: string | null) => {
    setBusy(true);
    try {
      await api(`/api/music/artists/${artist.id}/photo`, { method: "PUT", body: { providerId } });
      toast.show(providerId ? "Photo changed" : "Using the album cover");
      void queryClient.invalidateQueries();
      onClose();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} head={<SheetHead title="Change photo" sub={artist.name} />}>
      <View style={{ paddingHorizontal: 12, gap: 10, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <SearchInput value={query} onChange={setQuery} placeholder="Artist" label="Search artist" icon onSubmit={() => query.trim() && void search(query.trim())} />
          <SearchButton disabled={busy || !query.trim()} onPress={() => void search(query.trim())} />
        </View>
        {options === null ? (
          <ResultBones round />
        ) : (
          <>
            {options.length === 0 ? <NoResults text="No photos found." /> : null}
            {options.map((o) => (
              <ResultCard
                key={o.providerId}
                selected={o.current}
                disabled={busy}
                onPress={() => void pick(o.providerId)}
                art={o.thumbUrl}
                round
                title={o.name}
                tags={[plural(o.fans, "fan"), o.current ? "Now" : null]}
              />
            ))}
            <Button label="Use the album cover" kind="secondary" disabled={busy} onPress={() => void pick(null)} />
          </>
        )}
      </View>
    </Sheet>
  );
}

// ---------- Pieces ----------

export function SheetHead({ title, sub, sub2 }: { title: string; sub?: string; sub2?: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="heading" numberOfLines={1}>
        {title}
      </Text>
      {sub ? (
        <Text variant="small" numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
      {sub2 ? <Text variant="small">{sub2}</Text> : null}
    </View>
  );
}

function ReviewHead({ from, onBack }: { from: string; onBack: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginLeft: -12 }}>
      <IconButton label="Back to the results" onPress={onBack}>
        <BackIcon size={22} color={t.text} />
      </IconButton>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="heading">Review changes</Text>
        <Text variant="small">From {from}</Text>
      </View>
    </View>
  );
}

function ResultsFoot({ count, picked, busy, onPress }: { count: number; picked: boolean; busy: boolean; onPress: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Text variant="small" style={{ flex: 1 }}>
        {plural(count, "result")}
      </Text>
      <Button label={picked ? "Review changes" : "Pick a result"} busy={busy} disabled={!picked} onPress={onPress} style={{ height: 48 }} />
    </View>
  );
}

function ApplyButton({ count, busy, onPress }: { count: number; busy: boolean; onPress: () => void }) {
  return <Button label={count ? `Apply ${plural(count, "field")}` : "Pick a field"} busy={busy} disabled={count === 0} onPress={onPress} />;
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  icon,
  onSubmit,
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
  label: string;
  icon?: boolean;
  onSubmit: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: t.surface2 }}>
      {icon ? <SearchIcon size={20} color={t.muted} /> : null}
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        accessibilityLabel={label}
        placeholderTextColor={t.faint}
        selectionColor={t.accent}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        style={{ flex: 1, color: t.text, fontFamily: fonts.medium, fontSize: 15 }}
      />
    </View>
  );
}

export function SearchButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  return <Button label="Search" kind="secondary" disabled={disabled} onPress={onPress} style={{ height: 48, paddingHorizontal: 18 }} />;
}

/** A result's score out of 100: green when it's surely the one, amber when it may be. */
export function ScorePill({ score }: { score: number }) {
  const t = useTheme();
  const color = score >= 90 ? "#5ccf8a" : score >= 70 ? "#f0b45a" : null;
  return (
    <View style={{ alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: color ? `${color}40` : t.surface2 }}>
      <Text style={{ fontFamily: fonts.extrabold, fontSize: 12, color: color ?? t.muted }}>{score}</Text>
    </View>
  );
}

function ResultCard({
  selected,
  disabled,
  onPress,
  art,
  round,
  title,
  sub,
  tags,
  reasons,
  score,
}: {
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  art: string | null;
  round?: boolean;
  title: string;
  sub?: string;
  tags: (string | null)[];
  reasons?: string[];
  score?: number;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        gap: 12,
        padding: 10,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: selected ? t.accent : t.line,
        backgroundColor: pressed ? t.surface2 : "transparent",
      })}
    >
      <Cover path={art} title={title} size={56} radius={round ? 28 : 6} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {title}
        </Text>
        {sub ? (
          <Text variant="small" numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
        <Pills labels={tags.filter((x): x is string => !!x)} />
        {reasons?.map((r) => (
          <Text key={r} variant="small" style={{ fontSize: 12 }}>
            {r}
          </Text>
        ))}
      </View>
      {score !== undefined ? <ScorePill score={score} /> : null}
    </Pressable>
  );
}

/** Each field a result has: tick it to take it, the old value struck through above the new one. */
function ReviewList<F extends string, V extends { coverWidth: number | null }>({
  fields,
  current,
  proposed,
  chosen,
  setChosen,
  can,
  same,
  note,
}: {
  fields: { field: F; label: string; text: (v: V) => string | null }[];
  current: V;
  proposed: V;
  chosen: Set<F>;
  setChosen: (next: Set<F>) => void;
  can: (f: F) => boolean;
  same: (f: F) => boolean;
  note: (f: F) => string | null;
}) {
  const t = useTheme();
  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
      {fields.map(({ field, label, text }) => {
        const ok = can(field);
        const on = ok && chosen.has(field);
        const now = text(current);
        const next = text(proposed);
        const why = note(field);
        return (
          <Pressable
            key={field}
            accessibilityRole="checkbox"
            accessibilityLabel={label}
            accessibilityState={{ checked: on, disabled: !ok }}
            disabled={!ok}
            onPress={() => {
              const out = new Set(chosen);
              if (on) out.delete(field);
              else out.add(field);
              setChosen(out);
            }}
            style={{ flexDirection: "row", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.line }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                marginTop: 1,
                borderRadius: 6,
                borderWidth: on ? 0 : 1.5,
                borderColor: t.muted,
                backgroundColor: on ? t.accent : "transparent",
                alignItems: "center",
                justifyContent: "center",
                opacity: ok ? 1 : 0.4,
              }}
            >
              {on ? <CheckIcon size={14} color={t.onAccent} /> : null}
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="bodyStrong" style={{ fontSize: 14, color: ok ? t.text : t.muted }}>
                {label}
              </Text>
              {field === "cover" ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <CoverWithSize uri={now} width={current.coverWidth} />
                  <Text variant="small">→</Text>
                  <CoverWithSize uri={next} width={proposed.coverWidth} />
                </View>
              ) : same(field) ? (
                <Text variant="small" numberOfLines={2}>
                  {now} <Text variant="small" style={{ color: t.faint }}>Same</Text>
                </Text>
              ) : (
                <>
                  {now ? (
                    <Text variant="small" numberOfLines={field === "tracks" ? 3 : 2} style={{ textDecorationLine: "line-through", color: t.faint }}>
                      {now}
                    </Text>
                  ) : null}
                  <Text numberOfLines={field === "description" ? 4 : undefined} style={{ fontFamily: fonts.medium, fontSize: 14, color: next ? t.text : t.faint }}>
                    {next ?? "None"}
                  </Text>
                </>
              )}
              {why ? (
                <Text variant="small" style={{ color: t.danger }}>
                  {why}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function CoverWithSize({ uri, width }: { uri: string | null; width: number | null }) {
  return (
    <View style={{ alignItems: "center", gap: 2 }}>
      <Cover path={uri} title="" size={56} radius={6} />
      <Text variant="small" style={{ fontSize: 11 }}>
        {uri ? (width ? `${width}px` : " ") : "None"}
      </Text>
    </View>
  );
}

function ResultBones({ round }: { round?: boolean }) {
  return (
    <Skeleton style={{ gap: 8 }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ flexDirection: "row", gap: 12, padding: 10 }}>
          <Bone width={56} height={56} radius={round ? 28 : 6} />
          <View style={{ flex: 1, gap: 8, paddingTop: 2 }}>
            <Bone width="70%" height={15} />
            <Bone width="45%" height={11} />
            <Bone width="60%" height={18} radius={9} />
          </View>
        </View>
      ))}
    </Skeleton>
  );
}

function NoResults({ text = "No results." }: { text?: string }) {
  return (
    <Text variant="small" style={{ textAlign: "center", paddingVertical: 16 }}>
      {text}
    </Text>
  );
}
