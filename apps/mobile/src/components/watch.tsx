import { memo, useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import {
  apiPaths,
  episodeLabel,
  errorText,
  fileDetailParts,
  type HealthDto,
  percentDone,
  QUALITY_LABEL,
  timeLeft,
  type MovieDetail,
  type ShowDetail,
  type VideoEpisode,
  type VideoFileInfo,
  type VideoQuality,
  type WatchCard,
  type WatchMatchResult,
} from "@murmur/shared/client";
import { api } from "@/lib/api";
import { useVideoQuality } from "@/lib/data";
import { downloadingText, downloadMovie, downloadTvEpisode, removeDownload, useDownload } from "@/lib/downloads";
import { invalidateWatch, openVideoPlayer } from "@/lib/watch";
import { convertsPicture, videoDownloadSource } from "@/player/video";
import { fonts, useTheme } from "@/theme";
import { Cover } from "./cover";
import { HeroBackdrop } from "./hero";
import { CheckIcon, DownloadIcon, PlayIcon, RefreshIcon, SearchIcon } from "./icons";
import { PAD } from "./library";
import { Pills } from "./music";
import { BackRow, SectionTitle, useTopInset } from "./page";
import { RemoveDownloadSheet, Sheet, SheetItem } from "./sheet";
import { toast } from "./toast";
import { Button, IconButton, RoundButton, Text } from "./ui";

/** A 2:3 poster, or a tinted tile with the title when there's none. */
export function Poster({
  kind,
  id,
  hash,
  color,
  title,
  width,
  large,
  radius = 8,
}: {
  kind: "movie" | "show";
  id: string;
  hash: string | null;
  color: string | null;
  title: string;
  width?: number;
  large?: boolean;
  radius?: number;
}) {
  const path = hash ? (kind === "movie" ? apiPaths.movieArtUrl : apiPaths.showArtUrl)(id, "poster", hash, large ? "large" : "small") : null;
  return <Cover path={path} title={title} color={color} size={width} radius={radius} aspectRatio={2 / 3} />;
}

/** A 16:9 still of a movie version or an episode; a tinted tile stands in without one. */
export function Still({ videoId, hash, title, width, radius = 8 }: { videoId: string; hash: string | null; title: string; width?: number; radius?: number }) {
  return <Cover path={hash ? apiPaths.videoStillUrl(videoId, hash, "small") : null} title={title} size={width} radius={radius} aspectRatio={16 / 9} />;
}

/** A thin bar along the bottom of a poster or still. */
export function ArtBar({ pct }: { pct: number }) {
  const t = useTheme();
  return (
    <View style={{ position: "absolute", left: 6, right: 6, bottom: 6, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)", overflow: "hidden" }}>
      <View style={{ width: `${pct}%`, height: "100%", backgroundColor: t.accent }} />
    </View>
  );
}

export interface PosterItem {
  kind: "movie" | "show";
  id: string;
  title: string;
  year: string | null;
  posterHash: string | null;
  color: string | null;
  watched: boolean;
  /** How far through a movie you are, for its bar. */
  percent?: number;
}

/** A poster in a grid or shelf: the poster, the title and the year, with the accent check once watched. */
export const PosterCard = memo(function PosterCard({ item, width, onPress }: { item: PosterItem; width: number; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={item.title} onPress={onPress} style={({ pressed }) => ({ width, gap: 6, opacity: pressed ? 0.75 : 1 })}>
      <View>
        <Poster kind={item.kind} id={item.id} hash={item.posterHash} color={item.color} title={item.title} width={width} />
        {item.watched ? (
          <View
            accessibilityLabel="Watched"
            style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}
          >
            <CheckIcon size={14} color={t.onAccent} />
          </View>
        ) : item.percent ? (
          <ArtBar pct={item.percent} />
        ) : null}
      </View>
      <View>
        <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14 }}>
          {item.title}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {item.year ?? " "}
        </Text>
      </View>
    </Pressable>
  );
});

export const STILL_CARD_WIDTH = 220;

/**
 * A card in Continue watching or Next episodes: the still with how far you are, the movie or
 * show, and which episode with the time left on the right. Tapping it plays.
 */
export function StillCard({ card }: { card: WatchCard }) {
  const position = card.progress && !card.progress.finished ? card.progress.positionSec : 0;
  const left = position > 0 ? timeLeft(card.durationSec, position) : null;
  const episode = card.kind === "episode";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={episode ? `${card.title}, ${episodeLabel(card.season ?? 1, card.episode ?? 0)}` : card.title}
      onPress={() => openVideoPlayer(episode ? { kind: "episode", id: card.id, showId: card.showId! } : { kind: "movie", id: card.id })}
      style={({ pressed }) => ({ width: STILL_CARD_WIDTH, gap: 8, opacity: pressed ? 0.75 : 1 })}
    >
      <View>
        <Still videoId={card.stillId} hash={card.stillHash} title={card.title} radius={10} />
        {position > 0 ? <ArtBar pct={percentDone(position, card.durationSec)} /> : null}
      </View>
      <View>
        <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14 }}>
          {card.title}
        </Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text variant="small" numberOfLines={1} style={{ fontSize: 12, flexShrink: 1 }}>
            {episode ? episodeLabel(card.season ?? 1, card.episode ?? 0) : (left ?? " ")}
          </Text>
          {episode && left ? (
            <Text variant="small" numberOfLines={1} style={{ fontSize: 12 }}>
              {left}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/** The wide accent button on a movie or show page: Play, Resume, or All watched (disabled). */
export function WidePlayButton({ label, text, done, onPress }: { label: string; text: string; done?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: done }}
      disabled={done}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 56,
        borderRadius: 28,
        backgroundColor: done ? t.chip : t.accent,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingHorizontal: 16,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {done ? <CheckIcon size={20} color={t.muted} /> : <PlayIcon size={22} color={t.onAccent} />}
      <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.bold, fontSize: 15, color: done ? t.muted : t.onAccent }}>
        {text}
      </Text>
    </Pressable>
  );
}

/** The sheet with the two qualities a converted picture is made at. */
export function QualitySheet({ open, value, onClose, onPick }: { open: boolean; value: VideoQuality; onClose: () => void; onPick: (q: VideoQuality) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Quality">
      {(["full", "light"] as const).map((q) => (
        <SheetItem key={q} label={QUALITY_LABEL[q]} active={q === value} onPress={() => onPick(q)} />
      ))}
    </Sheet>
  );
}

/**
 * The quality button beside Play, shown only when the picture will be converted, since otherwise
 * it changes nothing. It starts at your setting and applies to this viewing only; `value` null
 * means your setting.
 */
export function QualityButton({ file, value, onChange }: { file: VideoFileInfo | null; value: VideoQuality | null; onChange: (q: VideoQuality) => void }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const fallback = useVideoQuality();
  if (!file || !convertsPicture(file)) return null;
  const current = value ?? fallback;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Quality ${QUALITY_LABEL[current]}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          height: 56,
          paddingHorizontal: 18,
          borderRadius: 28,
          backgroundColor: t.chip,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ fontFamily: fonts.bold, fontSize: 15 }}>{QUALITY_LABEL[current]}</Text>
      </Pressable>
      <QualitySheet
        open={open}
        value={current}
        onClose={() => setOpen(false)}
        onPick={(q) => {
          onChange(q);
          setOpen(false);
        }}
      />
    </>
  );
}

// ---------- Downloads ----------

/** Downloads a movie version, with the audio track and quality it would play at. */
export async function startMovieDownload(movie: MovieDetail, versionId: string, quality: VideoQuality | null) {
  const v = movie.versionList.find((x) => x.id === versionId) ?? movie.versionList[0]!;
  downloadMovie(movie, v.id, await videoDownloadSource(v.file, v.id, movie.id, quality));
}

/** Downloads an episode, with the audio track and quality it would play at. */
export async function startEpisodeDownload(show: ShowDetail, e: VideoEpisode, quality: VideoQuality | null) {
  downloadTvEpisode(show, e, await videoDownloadSource(e.file, e.id, show.id, quality));
}

/**
 * A download control, round beside Play on the movie page or a plain icon on an episode row:
 * download, progress (tap to cancel), or downloaded (tap to remove, asking first).
 */
export function VideoDownloadButton({
  type,
  id,
  title,
  round,
  onDownload,
}: {
  type: "movie" | "show";
  id: string;
  title: string;
  round?: boolean;
  onDownload: () => void;
}) {
  const t = useTheme();
  const d = useDownload(type, id);
  const [confirm, setConfirm] = useState(false);
  const pct = d ? Math.round(d.progress * 100) : 0;
  const label =
    d?.status === "done"
      ? "Remove download"
      : d?.status === "downloading"
        ? `${downloadingText(d)}, tap to cancel`
        : d?.status === "error"
          ? "Download failed, try again"
          : "Download";
  const icon =
    d?.status === "done" ? (
      <CheckIcon size={20} color={t.accent} />
    ) : d?.status === "downloading" ? (
      <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: t.accent }}>{`${pct}%`}</Text>
    ) : (
      <DownloadIcon size={20} color={d?.status === "error" ? t.danger : round ? t.text : t.muted} />
    );
  const onPress = () => {
    if (d?.status === "done") setConfirm(true);
    else if (d?.status === "downloading") removeDownload(type, id);
    else onDownload();
  };
  return (
    <>
      {round ? (
        <RoundButton label={label} active={d?.status === "done"} onPress={onPress}>
          {icon}
        </RoundButton>
      ) : (
        <IconButton label={label} onPress={onPress}>
          {icon}
        </IconButton>
      )}
      <RemoveDownloadSheet open={confirm} title={title} onConfirm={() => removeDownload(type, id)} onClose={() => setConfirm(false)} />
    </>
  );
}

/** The top of a movie or show page: the poster beside the title and pills, over the blurred art. */
export function WatchHero({
  kind,
  id,
  title,
  posterHash,
  color,
  art,
  pills,
  right,
}: {
  kind: "movie" | "show";
  id: string;
  title: string;
  posterHash: string | null;
  color: string | null;
  /** What tints the header: the backdrop, else the poster, else a frame. */
  art: string | null;
  pills: string[];
  right?: React.ReactNode;
}) {
  const top = useTopInset();
  return (
    // Out to the screen's edges, so the tint behind it does too.
    <View style={{ paddingTop: top, marginHorizontal: -PAD, paddingHorizontal: PAD }}>
      <HeroBackdrop path={art} color={color} height={top + 330} />
      <BackRow right={right} />
      <View style={{ flexDirection: "row", gap: 16, alignItems: "flex-end", marginTop: 4 }}>
        <View style={{ borderRadius: 12, elevation: 10, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } }}>
          <Poster kind={kind} id={id} hash={posterHash} color={color} title={title} width={120} radius={12} large />
        </View>
        <View style={{ flex: 1, gap: 8, paddingBottom: 4 }}>
          <Text variant="title" style={{ fontSize: 22, lineHeight: 28 }} numberOfLines={3}>
            {title}
          </Text>
          <Pills labels={pills} />
        </View>
      </View>
    </View>
  );
}

/** Codecs, size and name of a file, at the bottom of a movie page. */
export function FileDetails({ file }: { file: VideoFileInfo }) {
  const t = useTheme();
  return (
    <>
      <SectionTitle title="File" />
      <View style={{ gap: 10 }}>
        {/* Long file names scroll sideways rather than wrapping. */}
        <Animated.ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Text variant="small" style={{ color: t.text2 }}>
            {file.fileName}
          </Text>
        </Animated.ScrollView>
        <Pills labels={fileDetailParts(file)} />
      </View>
    </>
  );
}

const SCAN_POLL_MS = 2000;

/** Admins: rescans the movies and shows folders (and matches what's new), spinning until it's done. */
export function RescanButton() {
  const t = useTheme();
  const [scanning, setScanning] = useState(false);
  const spin = useSharedValue(0);
  useEffect(() => {
    if (scanning) spin.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1);
    else {
      cancelAnimation(spin);
      spin.value = withTiming(0, { duration: 200 });
    }
  }, [scanning, spin]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));

  const rescan = async () => {
    setScanning(true);
    try {
      await api("/api/watch/scan", { method: "POST" });
      // The scan runs in the background; health says when it's finished.
      for (;;) {
        await new Promise((r) => setTimeout(r, SCAN_POLL_MS));
        const health = await api<HealthDto>("/api/health");
        if (!health.watch?.scan.running) break;
      }
      invalidateWatch();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setScanning(false);
    }
  };
  return (
    <IconButton label={scanning ? "Scanning" : "Rescan movies and shows"} disabled={scanning} onPress={() => void rescan()}>
      <Animated.View style={style}>
        <RefreshIcon color={t.text} />
      </Animated.View>
    </IconButton>
  );
}

/**
 * Match for a movie or show, like the web's: the title and year to search, TMDB's results, and
 * picking one applies it straight away.
 */
export function WatchMatchSheet(props: {
  open: boolean;
  onClose: () => void;
  kind: "movie" | "show";
  id: string;
  title: string;
  year: string | null;
  tmdbId: number | null;
}) {
  return (
    <Sheet open={props.open} onClose={props.onClose} title="Match">
      {props.open ? <MatchBody {...props} /> : null}
    </Sheet>
  );
}

const matchSearch = (kind: "movie" | "show", q: string, y: string) => {
  const params = new URLSearchParams({ kind, q });
  if (/^\d{4}$/.test(y)) params.set("year", y);
  return api<WatchMatchResult[]>(`/api/watch/match?${params}`);
};

function MatchBody({ onClose, kind, id, title, year, tmdbId }: Parameters<typeof WatchMatchSheet>[0]) {
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
      onClose();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const input = { color: t.text, fontFamily: fonts.medium, fontSize: 15 } as const;
  return (
    <View style={{ paddingHorizontal: 12, gap: 12, paddingBottom: 8 }}>
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
          <View style={{ paddingVertical: 24 }}>
            <ActivityIndicator color={t.muted} />
          </View>
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
                borderColor: r.tmdbId === tmdbId ? t.accent : "transparent",
                backgroundColor: pressed ? t.surface2 : t.chip,
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
