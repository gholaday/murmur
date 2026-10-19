import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { apiPaths, duration, type EpisodeWithShow, shortDate, timeLeft } from "@murmur/shared";
import { setFinished } from "@/lib/data";
import { downloadEpisode, removeDownload, useDownload } from "@/lib/downloads";
import { episodeToPlayable, isCurrent, markCurrent, play, queueAdd, toggle, usePlayer, usePosition } from "@/player/engine";
import { fonts, useTheme } from "@/theme";
import { Cover } from "./cover";
import { RemoveDownloadSheet } from "./sheet";
import { toast } from "./toast";
import { CheckIcon, DownloadIcon, PauseIcon, PlayIcon } from "./icons";
import { Text } from "./ui";

/** Progress ring drawn around the play button. */
function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 21;
  const c = 2 * Math.PI * r;
  return (
    <Svg width={44} height={44} viewBox="0 0 44 44" style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
      <Circle cx={22} cy={22} r={r} stroke={color} strokeWidth={1.5} fill="none" strokeDasharray={`${(pct / 100) * c} ${c}`} />
    </Svg>
  );
}

export function EpisodeRow({ episode, showThumb = false }: { episode: EpisodeWithShow; showThumb?: boolean }) {
  const t = useTheme();
  const player = usePlayer();
  const live = usePosition();
  const dl = useDownload("episode", episode.id);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const current = isCurrent(player, "episode", episode.id);
  const played = !!episode.progress?.finished && !current;
  const dur = (current ? player.item?.durationSec : null) || episode.durationSec || 0;
  const position = current ? live : episode.progress && !episode.progress.finished ? episode.progress.positionSec : 0;
  const pct = dur ? Math.min(100, (position / dur) * 100) : 0;
  const queued = player.queue.some((q) => q.itemType === "episode" && q.itemId === episode.id);
  const playingNow = current && player.playing;
  const length = played
    ? "Played"
    : playingNow && dur
      ? `Playing, ${timeLeft(dur, position)}`
      : position > 5 && dur
        ? timeLeft(dur, position)
        : duration(dur);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast.show(done);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const onPlay = () => {
    if (current) return toggle();
    play(episodeToPlayable(episode), played ? 0 : undefined);
  };

  return (
    <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.line, opacity: played ? 0.6 : 1 }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        {showThumb ? (
          <Cover
            path={episode.podcastCoverHash ? apiPaths.podcastCoverUrl(episode.podcastId, episode.podcastCoverHash, 200) : null}
            title={episode.podcastTitle}
            color={episode.podcastCoverColor}
            size={56}
            radius={8}
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((o) => !o)}
          style={{ flex: 1, gap: 3 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", columnGap: 8 }}>
            {showThumb ? (
              <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.semibold, fontSize: 13, color: t.muted }}>
                {episode.podcastTitle}
              </Text>
            ) : null}
            <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: t.text2 }}>{shortDate(episode.publishedAt)}</Text>
            <Text style={{ fontFamily: current ? fonts.semibold : fonts.medium, fontSize: 11, color: current ? t.accent : t.muted }}>{length}</Text>
            {dl?.status === "done" ? <DownloadIcon size={13} color={t.accent} /> : null}
            {dl?.status === "downloading" ? <Text style={{ fontSize: 11, color: t.accent }}>{Math.round(dl.progress * 100)}%</Text> : null}
          </View>
          <Text variant="bodyStrong" numberOfLines={2} style={{ fontSize: 15, lineHeight: 20 }}>
            {episode.title}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={current && player.playing ? "Pause" : played ? "Play again" : "Play"}
          onPress={onPlay}
          hitSlop={6}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            borderWidth: pct > 0 && !played ? 0 : 1.5,
            borderColor: t.track,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {pct > 0 && !played ? (
            <>
              <View style={{ position: "absolute", inset: 0, borderRadius: 22, borderWidth: 1.5, borderColor: t.track }} />
              <Ring pct={pct} color={t.accent} />
            </>
          ) : null}
          {current && player.loading ? (
            <ActivityIndicator size="small" color={t.accent} />
          ) : current && player.playing ? (
            <PauseIcon size={18} color={t.text} />
          ) : played ? (
            <CheckIcon size={18} color={t.text} />
          ) : (
            <PlayIcon size={16} color={t.text} />
          )}
        </Pressable>
      </View>
      {open ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          <Action label="Play next" disabled={busy || current} onPress={() => void run(() => queueAdd({ itemType: "episode", itemId: episode.id }, "next"), "Plays next")} />
          <Action
            label={queued ? "In Up Next" : "Add to Up Next"}
            disabled={busy || current || queued}
            onPress={() => void run(() => queueAdd({ itemType: "episode", itemId: episode.id }, "last"), "Added to Up Next")}
          />
          <Action
            label={episode.progress?.finished ? "Mark unplayed" : "Mark played"}
            disabled={busy}
            onPress={() =>
              void run(async () => {
                if (current) markCurrent(!played);
                else await setFinished("episode", episode.id, dur, !episode.progress?.finished);
              }, episode.progress?.finished ? "Marked as unplayed" : "Marked as played")
            }
          />
          <Action
            label={dl ? (dl.status === "downloading" ? "Cancel download" : "Remove download") : "Download"}
            onPress={() =>
              dl?.status === "done" ? setConfirmRemove(true) : dl ? removeDownload("episode", episode.id) : downloadEpisode(episode)
            }
          />
        </View>
      ) : null}
      {confirmRemove ? (
        <RemoveDownloadSheet
          open
          title={episode.title}
          onConfirm={() => removeDownload("episode", episode.id)}
          onClose={() => setConfirmRemove(false)}
        />
      ) : null}
    </View>
  );
}

function Action({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 36,
        paddingHorizontal: 14,
        borderRadius: 18,
        justifyContent: "center",
        backgroundColor: pressed ? t.surface2 : t.chip,
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: t.text }}>{label}</Text>
    </Pressable>
  );
}
