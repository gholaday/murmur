import { memo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { router } from "expo-router";
import { apiPaths, duration, type EpisodeWithShow, shortDate, timeLeft } from "@murmur/shared/client";
import { setFinished, useEpisodeNotes } from "@/lib/data";
import { downloadEpisode, removeDownload, useDownload } from "@/lib/downloads";
import { episodeToPlayable, isCurrent, markCurrent, play, queueAdd, queueReplace, toggle, useItemPosition, usePlayer } from "@/player/engine";
import { fonts, useTheme } from "@/theme";
import { Cover } from "./cover";
import { DownloadIcon, PauseIcon, PlayedIcon, PlayIcon, PlayNextIcon, QueueAddIcon } from "./icons";
import { RemoveDownloadSheet } from "./sheet";
import { toast } from "./toast";
import { IconButton, Text } from "./ui";

/**
 * One episode: artwork, date and title, a line of description (tap the text for all of it),
 * and its actions always on show underneath. Matches the web's episode row.
 */
export const EpisodeRow = memo(function EpisodeRow({
  episode,
  showThumb = false,
  newCount = 0,
}: {
  episode: EpisodeWithShow;
  /** Lists across podcasts show the artwork and podcast name, which open the podcast. */
  showThumb?: boolean;
  /** When this row stands for a show's new episodes, how many there are; links to the show. */
  newCount?: number;
}) {
  const t = useTheme();
  const player = usePlayer();
  const live = useItemPosition("episode", episode.id) ?? 0;
  const dl = useDownload("episode", episode.id);
  const [open, setOpen] = useState(false);
  const notes = useEpisodeNotes(episode, open);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const current = isCurrent(player, "episode", episode.id);
  const played = !!episode.progress?.finished && !current;
  const finished = !!episode.progress?.finished;
  const dur = (current ? player.item?.durationSec : null) || episode.durationSec || 0;
  const position = current ? live : episode.progress && !episode.progress.finished ? episode.progress.positionSec : 0;
  const pct = dur ? Math.min(100, (position / dur) * 100) : 0;
  const queued = player.queue.some((q) => q.itemType === "episode" && q.itemId === episode.id);
  const pausing = current && player.playing;
  const time = played ? "Played" : position > 5 && dur ? timeLeft(dur, position) : duration(dur);
  const ref = { itemType: "episode" as const, itemId: episode.id };

  const openShow = () => router.push(`/show/${episode.podcastId}`);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.show(done);
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

  const toggleQueue = () =>
    queued
      ? run(
          () =>
            queueReplace(
              player.queue.filter((q) => !(q.itemType === "episode" && q.itemId === episode.id)).map((q) => ({ itemType: q.itemType, itemId: q.itemId })),
            ),
          "Removed from Up Next",
        )
      : run(() => queueAdd(ref, "last"), "Added to Up Next");

  const togglePlayed = () =>
    run(
      async () => {
        if (current) markCurrent(!played);
        else await setFinished("episode", episode.id, dur, !finished);
      },
      finished ? "Marked as unplayed" : "Marked as played",
    );

  const onDownload = () => {
    if (dl?.status === "done") setConfirmRemove(true);
    else if (dl) removeDownload("episode", episode.id);
    else downloadEpisode(episode);
  };

  return (
    <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start", paddingTop: 14, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: t.line }}>
      {showThumb ? (
        <Pressable accessibilityRole="link" accessibilityLabel={episode.podcastTitle} onPress={openShow}>
          <Cover
            path={episode.podcastCoverHash ? apiPaths.podcastCoverUrl(episode.podcastId, episode.podcastCoverHash, 200) : null}
            title={episode.podcastTitle}
            color={episode.podcastCoverColor}
            size={64}
            radius={8}
          />
        </Pressable>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", columnGap: 10, marginBottom: 3 }}>
          {showThumb ? (
            <Pressable accessibilityRole="link" onPress={openShow} hitSlop={{ top: 8, bottom: 6 }} style={{ flexShrink: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 13, color: t.text2 }}>
                {episode.podcastTitle}
              </Text>
            </Pressable>
          ) : null}
          <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: t.muted }}>{shortDate(episode.publishedAt)}</Text>
          {newCount > 1 ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`${newCount} new episodes of ${episode.podcastTitle}`}
              onPress={openShow}
              hitSlop={8}
              style={({ pressed }) => ({
                marginLeft: "auto",
                minHeight: 22,
                paddingHorizontal: 9,
                paddingVertical: 4,
                borderRadius: 999,
                justifyContent: "center",
                backgroundColor: t.accent,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, includeFontPadding: false, color: t.onAccent }}>
                {newCount} new
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityHint={open ? "Shows less of the description" : "Shows the whole description"}
          onPress={() => setOpen((o) => !o)}
          style={{ gap: 3 }}
        >
          <Text variant="bodyStrong" style={{ fontSize: 15, lineHeight: 20, color: played ? t.muted : t.text }}>
            {episode.title}
          </Text>
          {notes ? (
            <Text numberOfLines={open ? undefined : 1} style={{ fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: t.muted }}>
              {notes}
            </Text>
          ) : null}
        </Pressable>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${pausing ? "Pause" : played ? "Play again" : "Play"}, ${time}`}
            onPress={onPlay}
            style={({ pressed }) => ({
              height: 32,
              borderRadius: 16,
              paddingLeft: 8,
              paddingRight: 12,
              marginRight: 6,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: t.accent,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            {current && player.loading ? (
              <ActivityIndicator size="small" color={t.onAccent} style={{ width: 16, height: 16 }} />
            ) : pausing ? (
              <PauseIcon size={16} color={t.onAccent} />
            ) : (
              <PlayIcon size={16} color={t.onAccent} />
            )}
            <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: t.onAccent }}>{time}</Text>
          </Pressable>
          {pct > 0 && !played ? (
            // Shrinks on narrow phones so the action bar never overflows.
            <View style={{ flexBasis: 56, flexShrink: 1, minWidth: 14, height: 4, borderRadius: 2, backgroundColor: t.line, overflow: "hidden", marginRight: 6 }}>
              <View style={{ width: `${pct}%`, height: "100%", backgroundColor: t.accent }} />
            </View>
          ) : null}
          <ActionIcon label="Play next" disabled={busy || current} onPress={() => void run(() => queueAdd(ref, "next"), "Plays next")}>
            <PlayNextIcon size={20} color={t.text2} />
          </ActionIcon>
          <ActionIcon label={queued ? "Remove from Up Next" : "Add to Up Next"} selected={queued} disabled={busy || current} onPress={() => void toggleQueue()}>
            <QueueAddIcon size={20} queued={queued} color={queued ? t.accent : t.text2} />
          </ActionIcon>
          <ActionIcon label={finished ? "Mark unplayed" : "Mark played"} selected={finished} disabled={busy} onPress={() => void togglePlayed()}>
            <PlayedIcon size={20} played={finished} color={finished ? t.accent : t.text2} checkColor={t.onAccent} />
          </ActionIcon>
          <ActionIcon
            label={dl ? (dl.status === "downloading" ? "Cancel download" : "Remove download") : "Download"}
            selected={dl?.status === "done"}
            onPress={onDownload}
          >
            {dl?.status === "downloading" ? (
              <Text style={{ fontFamily: fonts.bold, fontSize: 11, color: t.accent }}>{Math.round(dl.progress * 100)}%</Text>
            ) : (
              <DownloadIcon size={20} color={dl?.status === "done" ? t.accent : dl?.status === "error" ? t.danger : t.text2} />
            )}
          </ActionIcon>
        </View>
      </View>
      {confirmRemove ? (
        <RemoveDownloadSheet open title={episode.title} onConfirm={() => removeDownload("episode", episode.id)} onClose={() => setConfirmRemove(false)} />
      ) : null}
    </View>
  );
});

function ActionIcon({
  label,
  selected,
  disabled,
  onPress,
  children,
}: {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    // 38 wide so four fit beside the play pill on a phone; IconButton's hit slop keeps the target over 44.
    <IconButton label={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={{ width: 38, opacity: disabled ? 0.4 : 1 }}>
      {children}
    </IconButton>
  );
}
