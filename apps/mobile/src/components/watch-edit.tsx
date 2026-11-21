import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { apiPaths, changedFields, errorText, pastStart, showEpisodes, showPlayEpisode, type WatchArtOption, type WatchMatchResult } from "@murmur/shared/client";
import { absolute, api, authHeaders } from "@/lib/api";
import { selectHaptic } from "@/lib/haptics";
import { useIsAdmin } from "@/lib/session";
import { invalidateWatch, markWatched, openVideoPlayer, useMovie, useShow, type WatchMark } from "@/lib/watch";
import { fonts, useTheme } from "@/theme";
import { Cover } from "./cover";
import { SearchButton, SearchInput, SheetHead } from "./match";
import { PictureEdit, type PictureOption, usePicturePick } from "./picture-edit";
import { useHealth } from "./settings";
import { HideItem, Sheet, SheetDivider, SheetItem, useMenuIdle } from "./sheet";
import { Bone, Skeleton } from "./skeleton";
import { toast } from "./toast";
import { TextTabs } from "./text-tabs";
import { Button, Caption, EditFoot, Input, LinkButton, Text } from "./ui";

type WatchEditTab = "details" | "poster" | "backdrop" | "match";
type Picture = "poster" | "backdrop";

interface WatchEditable {
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
const useCanMatch = () => !!useHealth().data?.watch?.tmdb;

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
  onHidden,
  extra,
}: {
  kind: "movie" | "show";
  id: string;
  title: string;
  open: boolean;
  onClose: () => void;
  onIdle?: () => void;
  /** On the movie's or show's own page: goes back once it's hidden. */
  onHidden?: () => void;
  extra?: React.ReactNode;
}) {
  const admin = useIsAdmin();
  const canMatch = useCanMatch();
  // The details, for Resume, watched and Edit; already cached on the page itself.
  const movie = useMovie(kind === "movie" ? id : undefined).data;
  const show = useShow(kind === "show" ? id : undefined).data;
  const [editing, setEditing] = useState<WatchEditTab | null>(null);
  useMenuIdle(open || editing !== null, onIdle);

  let play: (() => void) | null = null;
  let resume = false;
  let watched = false;
  let items: WatchMark[] = [];
  if (movie) {
    resume = pastStart(movie.progress && !movie.progress.finished ? movie.progress.positionSec : 0);
    watched = !!movie.progress?.finished;
    play = () => openVideoPlayer({ kind: "movie", id });
    items = [{ id, durationSec: movie.durationSec, progress: movie.progress }];
  } else if (show) {
    const all = showEpisodes(show);
    const next = showPlayEpisode(show);
    resume = !!next && pastStart(next.progress && !next.progress.finished ? next.progress.positionSec : 0);
    watched = all.length > 0 && all.every((e) => e.progress?.finished);
    if (next) play = () => openVideoPlayer({ kind: "episode", id: next.id, showId: id });
    items = all.map((e) => ({ id: e.id, durationSec: e.durationSec, progress: e.progress }));
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
            markWatched(items, !watched, watched ? "Marked as not watched" : "Marked as watched");
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
        <HideItem kind={kind} id={id} title={title} onClose={onClose} onHidden={onHidden} />
      </Sheet>
      {admin && item ? <WatchEditSheet kind={kind} item={item} tab={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

/**
 * Edit for a movie or show, like the web's: its details, its pictures, and Match. What's saved
 * here wins over the files and TMDB from then on.
 */
function WatchEditSheet({ kind, item, tab, onClose }: { kind: "movie" | "show"; item: WatchEditable; tab: WatchEditTab | null; onClose: () => void }) {
  // Each opening starts afresh on the tab it was opened on; the sheet keeps it while it slides away.
  const [state, setState] = useState({ open: false, tab: "details" as WatchEditTab, round: 0 });
  if ((tab !== null) !== state.open) setState({ open: tab !== null, tab: tab ?? state.tab, round: tab !== null ? state.round + 1 : state.round });
  if (state.round === 0) return null;
  return <WatchEdit key={state.round} kind={kind} item={item} startTab={state.tab} open={state.open} onClose={onClose} />;
}

type Form = { title: string; year: string; description: string };

const FIELDS: { field: keyof Form; label: string }[] = [
  { field: "title", label: "Title" },
  { field: "year", label: "Year" },
  { field: "description", label: "Description" },
];

function WatchEdit({ kind, item, startTab, open, onClose }: { kind: "movie" | "show"; item: WatchEditable; startTab: WatchEditTab; open: boolean; onClose: () => void }) {
  const canMatch = useCanMatch();
  const [tab, setTab] = useState(startTab);
  const saved: Form = { title: item.title, year: item.year ?? "", description: item.description ?? "" };
  const [form, setForm] = useState(saved);
  const [busy, setBusy] = useState(false);
  const changes = changedFields(form, saved);
  const base = apiPaths.watchItem(kind, item.id);
  const picture = usePicturePick();
  const [match, setMatch] = useState<WatchMatchResult | null>(null);
  const [matching, setMatching] = useState(false);
  const pickTab = (next: WatchEditTab) => {
    setTab(next);
    picture.setPicked(null);
  };

  const applyMatch = async (r: WatchMatchResult) => {
    setMatching(true);
    try {
      await api(`${base}/match`, { method: "POST", body: { tmdbId: r.tmdbId } });
      toast.show(`Matched to ${r.title}`);
      invalidateWatch();
      onClose();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setMatching(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const sent: Form = { title: form.title.trim(), year: form.year.trim(), description: form.description.trim() };
      await api(base, { method: "PATCH", body: { title: sent.title, year: sent.year || null, description: sent.description || null } });
      // The saved copy comes back trimmed; the form follows, so Save doesn't count stray spaces.
      setForm(sent);
      toast.show("Saved");
      invalidateWatch();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  // Like the book's: a small poster, what's being edited, and its title and year.
  const artUrl = kind === "movie" ? apiPaths.movieArtUrl : apiPaths.showArtUrl;
  const head = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Cover path={item.posterHash ? artUrl(item.id, "poster", item.posterHash, "small") : null} title={item.title} color={item.color} size={32} aspectRatio={2 / 3} radius={4} />
      <View style={{ flex: 1 }}>
        <SheetHead title={kind === "movie" ? "Edit movie" : "Edit show"} sub={[item.title, item.year].filter(Boolean).join(", ")} />
      </View>
    </View>
  );
  const tabs: { id: WatchEditTab; label: string }[] = [
    { id: "details", label: "Details" },
    { id: "poster", label: "Poster" },
    { id: "backdrop", label: "Background" },
    ...(canMatch ? [{ id: "match" as const, label: "Match" }] : []),
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      head={head}
      tall
      // Save is for the details; the pictures and Match each have their own button, once something's picked.
      foot={
        tab === "details" ? (
          <EditFoot changes={changes} busy={busy} disabled={!form.title.trim()} onSave={() => void save()} />
        ) : tab === "match" ? (
          match && match.tmdbId !== item.tmdbId ? (
            <Button label={matching ? "Matching…" : "Use this match"} disabled={matching} onPress={() => void applyMatch(match)} />
          ) : null
        ) : (
          picture.foot
        )
      }
    >
      <View style={{ paddingHorizontal: 12, gap: 14, paddingBottom: 8 }}>
        <TextTabs options={tabs} value={tab} onPick={pickTab} label="Edit" />
        {tab === "details" ? (
          FIELDS.map(({ field, label }) => (
            <View key={field} style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Caption style={{ letterSpacing: 0.6 }}>{label}</Caption>
                <View style={{ flex: 1 }} />
                {/* Unsaved typing can be undone, as on the book's. */}
                {form[field] !== saved[field] ? <LinkButton label="Undo" onPress={() => setForm({ ...form, [field]: saved[field] })} /> : null}
              </View>
              <Input
                accessibilityLabel={label}
                value={form[field]}
                onChangeText={(text) => setForm({ ...form, [field]: text })}
                keyboardType={field === "year" ? "number-pad" : undefined}
                maxLength={field === "year" ? 4 : undefined}
                multiline={field === "description"}
                style={field === "description" ? { height: 160, paddingTop: 12, textAlignVertical: "top" } : undefined}
              />
            </View>
          ))
        ) : tab === "poster" || tab === "backdrop" ? (
          <ArtTab
            key={tab}
            which={tab}
            kind={kind}
            item={item}
            base={base}
            canSuggest={canMatch && item.tmdbId !== null}
            picked={picture.picked}
            onPick={picture.setPicked}
          />
        ) : (
          <WatchMatchPanel kind={kind} title={item.title} year={item.year} tmdbId={item.tmdbId} picked={match} onPick={setMatch} />
        )}
      </View>
    </Sheet>
  );
}

/**
 * The Poster or Background tab, laid out like the book's Cover: the picture now and where it's
 * from, then choose an image, paste a link, or pick one of TMDB's.
 */
function ArtTab({
  which,
  kind,
  item,
  base,
  canSuggest,
  picked,
  onPick,
}: {
  which: Picture;
  kind: "movie" | "show";
  item: WatchEditable;
  base: string;
  canSuggest: boolean;
  picked: string | null;
  onPick: (o: PictureOption | null) => void;
}) {
  const [options, setOptions] = useState<WatchArtOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const hash = which === "poster" ? item.posterHash : item.backdropHash;
  const artUrl = kind === "movie" ? apiPaths.movieArtUrl : apiPaths.showArtUrl;
  const poster = which === "poster";

  useEffect(() => {
    if (!canSuggest) return;
    let live = true;
    api<WatchArtOption[]>(`${base}/${which}/options`).then(
      (list) => live && setOptions(list),
      () => live && setOptions([]),
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

  const upload = (file: ImagePicker.ImagePickerAsset) => {
    void act(async () => {
      const body = new FormData();
      // React Native's FormData takes a file as its uri, name and type.
      body.append("image", { uri: file.uri, name: file.fileName ?? "image.jpg", type: file.mimeType ?? "image/jpeg" } as unknown as Blob);
      const res = await fetch(absolute(`${base}/${which}`), { method: "POST", headers: authHeaders(), body });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Upload failed (${res.status}).`);
    });
  };

  return (
    <PictureEdit
      path={hash ? artUrl(item.id, which, hash, "large") : null}
      title={item.title}
      color={item.color}
      aspectRatio={poster ? 2 / 3 : 16 / 9}
      source={item.chosenArt[which] ? "Your own picture" : hash ? "From TMDB" : "No picture yet"}
      // Takes off the chosen picture; TMDB's, or the files' after a rescan, comes back.
      reset={
        item.chosenArt[which]
          ? { label: "Use TMDB's picture", onPress: () => void act(() => api(`${base}/${which}`, { method: "DELETE" }), "Using TMDB's picture") }
          : undefined
      }
      busy={busy}
      onUpload={upload}
      onLink={(u) => act(() => api(`${base}/${which}`, { method: "POST", body: { url: u } }))}
      options={
        canSuggest
          ? options?.map((o) => ({
              key: o.tmdbPath,
              thumb: o.thumbUrl,
              label: "Pick this picture",
              apply: () => act(() => api(`${base}/${which}`, { method: "POST", body: { tmdbPath: o.tmdbPath } })),
            })) ?? null
          : undefined
      }
      emptyText="TMDB has no other pictures for this."
      picked={picked}
      onPick={onPick}
    />
  );
}

const matchSearch = (kind: "movie" | "show", q: string, y: string) =>
  api<WatchMatchResult[]>(apiPaths.watchMatchSearch({ kind, q, year: /^\d{4}$/.test(y) ? y : undefined }));

/**
 * Match, like the web's: the title and year to search and TMDB's results. Tapping a result only
 * picks it; the sheet's Use this match applies it.
 */
function WatchMatchPanel({
  kind,
  title,
  year,
  tmdbId,
  picked,
  onPick,
}: {
  kind: "movie" | "show";
  title: string;
  year: string | null;
  tmdbId: number | null;
  picked: WatchMatchResult | null;
  onPick: (r: WatchMatchResult | null) => void;
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

  // Until something is picked, the current match shows as the one.
  const isOn = (r: WatchMatchResult) => (picked ? r.tmdbId === picked.tmdbId : r.tmdbId === tmdbId);
  const submit = () => query.trim() && void search(query.trim(), yearText.trim());
  return (
    <View style={{ gap: 12, paddingBottom: 8 }}>
      <View style={{ flexDirection: "row" }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Title" label="Search title" icon onSubmit={submit} />
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <SearchInput value={yearText} onChange={setYearText} placeholder="Year" label="Year" year onSubmit={submit} />
        <SearchButton disabled={busy || !query.trim()} onPress={submit} />
      </View>
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
            accessibilityState={{ selected: isOn(r) }}
            onPress={() => {
              selectHaptic();
              onPick(picked?.tmdbId === r.tmdbId ? null : r);
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              gap: 12,
              padding: 8,
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: isOn(r) ? t.accent : t.line,
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
