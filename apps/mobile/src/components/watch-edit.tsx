import { useCallback, useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { apiPaths, errorText, pastStart, type WatchArtOption, type WatchMatchResult } from "@murmur/shared/client";
import { absolute, api, authHeaders } from "@/lib/api";
import { useSession } from "@/lib/session";
import { invalidateWatch, markWatched, openVideoPlayer, showEpisodes, useMovie, useShow } from "@/lib/watch";
import { fonts, useTheme } from "@/theme";
import { Cover } from "./cover";
import { SearchIcon } from "./icons";
import { SheetHead } from "./match";
import { useHealth } from "./settings";
import { Sheet, SheetDivider, SheetItem, useMenuIdle } from "./sheet";
import { Bone, Skeleton } from "./skeleton";
import { toast } from "./toast";
import { Button, Chips, Field, Text } from "./ui";

export type WatchEditTab = "details" | "artwork" | "match";

export interface WatchEditable {
  id: string;
  title: string;
  year: string | null;
  description: string | null;
  posterHash: string | null;
  backdropHash: string | null;
  color: string | null;
  tmdbId: number | null;
  /** A picture chosen in Edit, which Remove takes off again. */
  chosenArt: { poster: boolean; backdrop: boolean };
}

/** TMDB is set up on the server, so Match and the picture suggestions work. */
export const useCanMatch = () => !!useHealth().data?.watch?.tmdb;

/**
 * A movie or show's menu, the same from a poster's long press and the page's ⋯ (like the web's):
 * Play or Resume and watched, the page's own `extra` items, then for admins Edit and Match.
 */
export function WatchActions({
  kind,
  id,
  title,
  open,
  onClose,
  onIdle,
  extra,
}: {
  kind: "movie" | "show";
  id: string;
  title: string;
  open: boolean;
  onClose: () => void;
  onIdle?: () => void;
  extra?: React.ReactNode;
}) {
  const admin = !!useSession().user?.isAdmin;
  const canMatch = useCanMatch();
  // The details, for Resume, watched and Edit; already cached on the page itself.
  const movie = useMovie(kind === "movie" ? id : undefined).data;
  const show = useShow(kind === "show" ? id : undefined).data;
  const [editing, setEditing] = useState<WatchEditTab | null>(null);
  useMenuIdle(open || editing !== null, onIdle);

  let play: (() => void) | null = null;
  let resume = false;
  let watched = false;
  let items: { id: string; durationSec: number }[] = [];
  if (movie) {
    resume = pastStart(movie.progress && !movie.progress.finished ? movie.progress.positionSec : 0);
    watched = !!movie.progress?.finished;
    play = () => openVideoPlayer({ kind: "movie", id });
    items = [{ id, durationSec: movie.durationSec }];
  } else if (show) {
    const all = showEpisodes(show);
    // Where Resume goes; once every episode is watched, the first.
    const next = all.find((e) => e.id === show.upNextId) ?? all[0];
    resume = !!next && pastStart(next.progress && !next.progress.finished ? next.progress.positionSec : 0);
    watched = all.length > 0 && all.every((e) => e.progress?.finished);
    if (next) play = () => openVideoPlayer({ kind: "episode", id: next.id, showId: id });
    items = all.map((e) => ({ id: e.id, durationSec: e.durationSec }));
  }
  const then = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const item = movie ?? show;

  return (
    <>
      <Sheet open={open} onClose={onClose} title={title}>
        <SheetItem label={resume ? "Resume" : "Play"} disabled={!play} onPress={then(() => play?.())} />
        <SheetItem
          label={watched ? "Mark as not watched" : "Mark as watched"}
          disabled={!item}
          onPress={then(() => {
            markWatched(items, !watched);
            toast.show(watched ? "Marked as not watched" : "Marked as watched");
          })}
        />
        {extra}
        {admin ? (
          <>
            <SheetDivider />
            <SheetItem label="Edit…" disabled={!item} onPress={then(() => setEditing("details"))} />
            {canMatch ? <SheetItem label="Match…" disabled={!item} onPress={then(() => setEditing("match"))} /> : null}
          </>
        ) : null}
      </Sheet>
      {admin && item ? <WatchEditSheet kind={kind} item={item} tab={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

/**
 * Edit for a movie or show, like the web's: its details, its pictures, and Match. What's saved
 * here wins over the files and TMDB from then on.
 */
export function WatchEditSheet({ kind, item, tab, onClose }: { kind: "movie" | "show"; item: WatchEditable; tab: WatchEditTab | null; onClose: () => void }) {
  // Each opening starts afresh on the tab it was opened on; the sheet keeps it while it slides away.
  const [state, setState] = useState({ open: false, tab: "details" as WatchEditTab, round: 0 });
  if ((tab !== null) !== state.open) setState({ open: tab !== null, tab: tab ?? state.tab, round: tab !== null ? state.round + 1 : state.round });
  if (state.round === 0) return null;
  return <WatchEdit key={state.round} kind={kind} item={item} startTab={state.tab} open={state.open} onClose={onClose} />;
}

function WatchEdit({ kind, item, startTab, open, onClose }: { kind: "movie" | "show"; item: WatchEditable; startTab: WatchEditTab; open: boolean; onClose: () => void }) {
  const canMatch = useCanMatch();
  const [tab, setTab] = useState(startTab);
  const saved = { title: item.title, year: item.year ?? "", description: item.description ?? "" };
  const [form, setForm] = useState(saved);
  const [busy, setBusy] = useState(false);
  const dirty = form.title !== saved.title || form.year !== saved.year || form.description !== saved.description;
  const base = `/api/watch/${kind === "movie" ? "movies" : "shows"}/${item.id}`;

  const save = async () => {
    setBusy(true);
    try {
      await api(base, { method: "PATCH", body: { title: form.title.trim(), year: form.year.trim() || null, description: form.description.trim() || null } });
      toast.show("Saved");
      invalidateWatch();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      head={<SheetHead title="Edit" sub={item.title} />}
      tall
      foot={tab === "details" ? <Button label="Save" busy={busy} disabled={!dirty || !form.title.trim()} onPress={() => void save()} /> : null}
    >
      <View style={{ paddingHorizontal: 12, gap: 14, paddingBottom: 8 }}>
        <Chips
          options={[
            { id: "details", label: "Details" },
            { id: "artwork", label: "Artwork" },
            ...(canMatch ? [{ id: "match" as const, label: "Match" }] : []),
          ]}
          value={tab}
          onPick={setTab}
          label="Edit"
        />
        {tab === "details" ? (
          <>
            <Field label="Title" value={form.title} onChangeText={(title) => setForm({ ...form, title })} />
            <Field label="Year" value={form.year} onChangeText={(year) => setForm({ ...form, year })} keyboardType="number-pad" maxLength={4} />
            <Field
              label="Description"
              value={form.description}
              onChangeText={(description) => setForm({ ...form, description })}
              multiline
              style={{ height: 140, paddingTop: 14, textAlignVertical: "top" }}
            />
          </>
        ) : tab === "artwork" ? (
          <Artwork kind={kind} item={item} base={base} canSuggest={canMatch && item.tmdbId !== null} />
        ) : (
          <WatchMatchPanel kind={kind} id={item.id} title={item.title} year={item.year} tmdbId={item.tmdbId} onMatched={onClose} />
        )}
      </View>
    </Sheet>
  );
}

/** The poster or the background: choose an image, paste a link, or pick one of TMDB's. */
function Artwork({ kind, item, base, canSuggest }: { kind: "movie" | "show"; item: WatchEditable; base: string; canSuggest: boolean }) {
  const t = useTheme();
  const [which, setWhich] = useState<"poster" | "backdrop">("poster");
  // TMDB's pictures for the kind they were loaded for; switching kinds shows placeholders until the others load.
  const [loaded, setLoaded] = useState<{ which: string; list: WatchArtOption[] } | null>(null);
  const options = loaded?.which === which ? loaded.list : null;
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const hash = which === "poster" ? item.posterHash : item.backdropHash;
  const artUrl = kind === "movie" ? apiPaths.movieArtUrl : apiPaths.showArtUrl;
  const poster = which === "poster";

  useEffect(() => {
    if (!canSuggest) return;
    let live = true;
    api<WatchArtOption[]>(`${base}/${which}/options`).then(
      (list) => live && setLoaded({ which, list }),
      () => live && setLoaded({ which, list: [] }),
    );
    return () => {
      live = false;
    };
  }, [base, which, canSuggest]);

  const act = async (send: () => Promise<unknown>, done = poster ? "Poster changed" : "Background changed") => {
    setBusy(true);
    try {
      await send();
      toast.show(done);
      invalidateWatch();
      return true;
    } catch (err) {
      toast.error(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    const file = picked.canceled ? null : picked.assets[0];
    if (!file) return;
    void act(async () => {
      const body = new FormData();
      // React Native's FormData takes a file as its uri, name and type.
      body.append("image", { uri: file.uri, name: file.fileName ?? "image.jpg", type: file.mimeType ?? "image/jpeg" } as unknown as Blob);
      const res = await fetch(absolute(`${base}/${which}`), { method: "POST", headers: authHeaders(), body });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Upload failed (${res.status}).`);
    });
  };

  const columns = poster ? 3 : 2;
  const thumb = { flexBasis: `${100 / columns - 3}%` as const, flexGrow: 0 };
  return (
    <>
      <Chips
        options={[
          { id: "poster", label: "Poster" },
          { id: "backdrop", label: "Background" },
        ]}
        value={which}
        onPick={setWhich}
        label="Picture"
      />
      <View style={{ width: poster ? 140 : "100%" }}>
        <Cover path={hash ? artUrl(item.id, which, hash, "large") : null} title={item.title} color={item.color} aspectRatio={poster ? 2 / 3 : 16 / 9} radius={10} />
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button label="Choose an image" kind="secondary" disabled={busy} onPress={() => void choose()} style={{ flex: 1 }} />
        {/* Takes off the chosen picture; TMDB's, or the files' after a rescan, comes back. */}
        {item.chosenArt[which] ? (
          <Button label="Remove" kind="secondary" disabled={busy} onPress={() => void act(() => api(`${base}/${which}`, { method: "DELETE" }), "Removed")} />
        ) : null}
      </View>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
        <View style={{ flex: 1 }}>
          <Field
            label="Or paste an image link"
            value={url}
            onChangeText={setUrl}
            placeholder="https://"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <Button
          label="Use link"
          kind="secondary"
          disabled={busy || !url.trim()}
          onPress={() => void act(() => api(`${base}/${which}`, { method: "POST", body: { url: url.trim() } })).then((ok) => ok && setUrl(""))}
          style={{ paddingHorizontal: 18 }}
        />
      </View>
      {canSuggest ? (
        <View style={{ gap: 10 }}>
          <Text variant="bodyStrong" style={{ fontSize: 14 }}>
            Suggestions
          </Text>
          {options === null ? (
            <Skeleton style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {Array.from({ length: columns * 2 }, (_, i) => (
                <View key={i} style={thumb}>
                  <Bone height={poster ? 120 : 90} radius={8} />
                </View>
              ))}
            </Skeleton>
          ) : options.length === 0 ? (
            <Text variant="small">TMDB has no other pictures for this.</Text>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {options.map((o) => (
                <Pressable
                  key={o.tmdbPath}
                  accessibilityRole="button"
                  accessibilityLabel="Use this picture"
                  disabled={busy}
                  onPress={() => void act(() => api(`${base}/${which}`, { method: "POST", body: { tmdbPath: o.tmdbPath } }))}
                  style={({ pressed }) => [thumb, { opacity: pressed || busy ? 0.6 : 1 }]}
                >
                  <Cover path={o.thumbUrl} title={item.title} color={t.surface2} aspectRatio={poster ? 2 / 3 : 16 / 9} radius={8} />
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ) : null}
    </>
  );
}

const matchSearch = (kind: "movie" | "show", q: string, y: string) => {
  const params = new URLSearchParams({ kind, q });
  if (/^\d{4}$/.test(y)) params.set("year", y);
  return api<WatchMatchResult[]>(`/api/watch/match?${params}`);
};

/** Match, like the web's: the title and year to search, TMDB's results, and picking one applies it straight away. */
function WatchMatchPanel({
  onMatched,
  kind,
  id,
  title,
  year,
  tmdbId,
}: {
  onMatched: () => void;
  kind: "movie" | "show";
  id: string;
  title: string;
  year: string | null;
  tmdbId: number | null;
}) {
  const t = useTheme();
  const [query, setQuery] = useState(title);
  const [yearText, setYearText] = useState(year ?? "");
  const [results, setResults] = useState<WatchMatchResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  const search = useCallback(
    async (q: string, y: string) => {
      setBusy(true);
      try {
        setResults(await matchSearch(kind, q, y));
      } catch (err) {
        toast.error(errorText(err));
        setResults([]);
      } finally {
        setBusy(false);
      }
    },
    [kind],
  );

  // Opens already searching for the title it has.
  useEffect(() => {
    let live = true;
    matchSearch(kind, title, year ?? "").then(
      (r) => live && setResults(r),
      (err: unknown) => {
        if (!live) return;
        toast.error(errorText(err));
        setResults([]);
      },
    );
    return () => {
      live = false;
    };
  }, [kind, title, year]);

  const pick = async (r: WatchMatchResult) => {
    setBusy(true);
    try {
      await api(`/api/watch/${kind === "movie" ? "movies" : "shows"}/${id}/match`, { method: "POST", body: { tmdbId: r.tmdbId } });
      toast.show(`Matched to ${r.title}`);
      invalidateWatch();
      onMatched();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const input = { color: t.text, fontFamily: fonts.medium, fontSize: 15 } as const;
  return (
    <View style={{ gap: 12, paddingBottom: 8 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: t.surface2 }}>
          <SearchIcon size={20} color={t.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Title"
            accessibilityLabel="Search title"
            placeholderTextColor={t.faint}
            selectionColor={t.accent}
            returnKeyType="search"
            onSubmitEditing={() => query.trim() && void search(query.trim(), yearText.trim())}
            style={[input, { flex: 1 }]}
          />
        </View>
        <TextInput
          value={yearText}
          onChangeText={setYearText}
          placeholder="Year"
          accessibilityLabel="Year"
          keyboardType="number-pad"
          maxLength={4}
          placeholderTextColor={t.faint}
          selectionColor={t.accent}
          returnKeyType="search"
          onSubmitEditing={() => query.trim() && void search(query.trim(), yearText.trim())}
          style={[input, { width: 76, height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: t.surface2 }]}
        />
      </View>
      <Button label="Search" busy={busy && results !== null} disabled={!query.trim()} onPress={() => void search(query.trim(), yearText.trim())} />
      {results === null ? (
        // Placeholders shaped like the result rows: a poster with a title, year and overview.
        <Skeleton style={{ gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ flexDirection: "row", gap: 12, padding: 8 }}>
              <Bone width={56} height={84} radius={6} />
              <View style={{ flex: 1, gap: 8, paddingTop: 2 }}>
                <Bone width="70%" height={15} />
                <Bone width="20%" height={11} />
                <Bone width="90%" height={11} />
              </View>
            </View>
          ))}
        </Skeleton>
      ) : results.length === 0 ? (
        <Text variant="small" style={{ textAlign: "center", paddingVertical: 16 }}>
          No results.
        </Text>
      ) : (
        results.map((r) => (
          <Pressable
            key={r.tmdbId}
            accessibilityRole="button"
            accessibilityState={{ selected: r.tmdbId === tmdbId, disabled: busy }}
            disabled={busy}
            onPress={() => void pick(r)}
            style={({ pressed }) => ({
              flexDirection: "row",
              gap: 12,
              padding: 8,
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: r.tmdbId === tmdbId ? t.accent : t.line,
              backgroundColor: pressed ? t.surface2 : "transparent",
            })}
          >
            <Cover path={r.posterUrl} title={r.title} size={56} radius={6} aspectRatio={2 / 3} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong" numberOfLines={2}>
                {r.title}
              </Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {r.year ? <Text variant="small">{r.year}</Text> : null}
                {r.tmdbId === tmdbId ? <Text variant="small" style={{ color: t.accent, fontFamily: fonts.bold }}>Now</Text> : null}
              </View>
              {r.overview ? (
                <Text variant="small" numberOfLines={2}>
                  {r.overview}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))
      )}
    </View>
  );
}
