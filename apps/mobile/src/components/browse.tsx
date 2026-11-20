import { createContext, useContext, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import { apiPaths, BROWSE_TOP_SIZE, errorText, PODCAST_GENRES, type PodcastSearchResult, type PodcastSummary, plural } from "@murmur/shared/client";
import { api } from "@/lib/api";
import { type BoxFound, refreshAfterSubscribe, useBoxResults, useBrowse, useMoreLike } from "@/lib/directory";
import { withLongPressHaptic } from "@/lib/haptics";
import { fonts, useTheme } from "@/theme";
import { Cover } from "./cover";
import { CheckIcon, HeartIcon } from "./icons";
import { PAD, SectionHead, Shelf, useShelfWidth } from "./library";
import { Empty, SectionTitle } from "./page";
import { Sheet, SheetItem, useCardMenu, useMenuIdle } from "./sheet";
import { Bone, FadeIn, SectionBone, Skeleton } from "./skeleton";
import { toast } from "./toast";
import { Button, IconButton, Text } from "./ui";

/**
 * Browse: finding shows to follow. Every show here (a search result, a chart entry, a suggestion)
 * is the same PodcastSearchResult and works the same way: the show opens its preview, and the
 * heart subscribes in place, turning into a check that opens the show. Matches the web's.
 */

type Directory = {
  /** Your podcast's id for a feed you follow, counting ones followed since the list loaded. */
  followedId: (s: PodcastSearchResult) => string | null;
  subscribe: (s: PodcastSearchResult) => Promise<void>;
  busy: string | null;
  isDismissed: (s: PodcastSearchResult) => boolean;
  notInterested: (s: PodcastSearchResult) => Promise<void>;
};

const DirectoryContext = createContext<Directory | null>(null);

function useDirectory(): Directory {
  const d = useContext(DirectoryContext);
  if (!d) throw new Error("useDirectory needs a DirectoryProvider");
  return d;
}

export function DirectoryProvider({ children }: { children: React.ReactNode }) {
  const [followed, setFollowed] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const followedId = (s: PodcastSearchResult) => followed[s.feedUrl] ?? s.subscribedId;

  const subscribe = async (s: PodcastSearchResult) => {
    setBusy(s.feedUrl);
    try {
      const podcast = await api<PodcastSummary>(apiPaths.podcasts, { method: "POST", body: { feedUrl: s.feedUrl } });
      setFollowed((f) => ({ ...f, [s.feedUrl]: podcast.id }));
      toast.show(`Subscribed to ${podcast.title}`, { action: { label: "Open", onPress: () => router.push(`/show/${podcast.id}`) } });
      refreshAfterSubscribe();
    } catch (err) {
      toast.error(errorText(err, "Couldn't subscribe to that podcast."));
    } finally {
      setBusy(null);
    }
  };

  const setDismissedOne = (feedUrl: string, on: boolean) =>
    setDismissed((d) => {
      const next = new Set(d);
      if (on) next.add(feedUrl);
      else next.delete(feedUrl);
      return next;
    });

  const notInterested = async (s: PodcastSearchResult) => {
    setDismissedOne(s.feedUrl, true);
    const send = (on: boolean) => api(apiPaths.podcastNotInterested, { method: on ? "PUT" : "DELETE", body: { feedUrl: s.feedUrl } });
    try {
      await send(true);
      toast.show(`You won't see ${s.title} here`, {
        duration: 5000,
        action: {
          label: "Undo",
          onPress: () => {
            setDismissedOne(s.feedUrl, false);
            send(false).catch((err: unknown) => {
              setDismissedOne(s.feedUrl, true);
              toast.error(errorText(err));
            });
          },
        },
      });
    } catch (err) {
      setDismissedOne(s.feedUrl, false);
      toast.error(errorText(err));
    }
  };

  return (
    <DirectoryContext.Provider value={{ followedId, subscribe, busy, isDismissed: (s) => dismissed.has(s.feedUrl), notInterested }}>
      {children}
    </DirectoryContext.Provider>
  );
}

/** The show's page once followed, its preview before. */
function openShow(s: PodcastSearchResult, id: string | null) {
  if (id) router.push(`/show/${id}`);
  else router.push({ pathname: "/preview", params: s.artworkUrl ? { feedUrl: s.feedUrl, art: s.artworkUrl } : { feedUrl: s.feedUrl } });
}

/** The heart that subscribes, or the check that opens the show once you follow it: on a cover's corner, or at a row's end. */
function SubscribeToggle({ show, corner }: { show: PodcastSearchResult; corner?: boolean }) {
  const t = useTheme();
  const d = useDirectory();
  const id = d.followedId(show);
  const disabled = !id && d.busy !== null;
  const icon = id ? (
    <CheckIcon size={corner ? 16 : 22} color={corner ? t.onAccent : t.accent} />
  ) : (
    <HeartIcon size={corner ? 16 : 22} color={corner ? "#fff" : t.muted} />
  );
  const label = id ? `Open ${show.title}` : `Subscribe to ${show.title}`;
  const onPress = () => (id ? router.push(`/show/${id}`) : void d.subscribe(show));
  if (!corner) {
    return (
      <IconButton label={label} disabled={disabled} onPress={onPress} style={{ opacity: disabled ? 0.45 : 1 }}>
        {icon}
      </IconButton>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        position: "absolute",
        right: 6,
        bottom: 6,
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        // Dark in both themes, so it reads on any cover.
        backgroundColor: id ? t.accent : pressed ? "rgba(11, 11, 13, 0.85)" : "rgba(11, 11, 13, 0.6)",
        opacity: disabled ? 0.45 : 1,
      })}
    >
      {icon}
    </Pressable>
  );
}

/** A show as a card on a shelf; a long press has its menu. */
function DirectoryCard({ show, width }: { show: PodcastSearchResult; width: number }) {
  const t = useTheme();
  const d = useDirectory();
  const menu = useCardMenu();
  const id = d.followedId(show);
  if (d.isDismissed(show)) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={show.author ? `${show.title}, ${show.author}` : show.title}
      accessibilityActions={[{ name: "longpress", label: "Options" }]}
      onAccessibilityAction={menu.show}
      onPress={() => openShow(show, id)}
      onLongPress={withLongPressHaptic(menu.show)}
      style={({ pressed }) => ({ width, gap: 6, opacity: pressed ? 0.75 : 1 })}
    >
      {menu.shown ? <CardMenu show={show} id={id} open={menu.open} onClose={menu.close} onIdle={menu.idle} /> : null}
      <View>
        <Cover path={show.artworkUrl} title={show.title} />
        <SubscribeToggle show={show} corner />
      </View>
      <Text variant="bodyStrong" numberOfLines={2} style={{ fontSize: 13 }}>
        {show.title}
      </Text>
      {show.author ? (
        <Text variant="small" numberOfLines={1} style={{ color: t.muted, marginTop: -4 }}>
          {show.author}
        </Text>
      ) : null}
    </Pressable>
  );
}

function CardMenu({ show, id, open, onClose, onIdle }: { show: PodcastSearchResult; id: string | null; open: boolean; onClose: () => void; onIdle: () => void }) {
  const d = useDirectory();
  useMenuIdle(open, onIdle);
  const choose = (fn: () => unknown) => () => {
    onClose();
    fn();
  };
  return (
    <Sheet open={open} onClose={onClose} title={show.title}>
      {id ? (
        <SheetItem label="Open" onPress={choose(() => router.push(`/show/${id}`))} />
      ) : (
        <SheetItem label="Subscribe" onPress={choose(() => d.subscribe(show))} />
      )}
      <SheetItem label="See episodes" onPress={choose(() => openShow(show, id))} />
      <SheetItem label="Not interested" onPress={choose(() => d.notInterested(show))} />
    </Sheet>
  );
}

/** A show as a list row: a rank on charts, the episode count on search results. */
export function DirectoryRow({ show, rank, sub }: { show: PodcastSearchResult; rank?: number; sub?: string | null }) {
  const t = useTheme();
  const d = useDirectory();
  if (d.isDismissed(show)) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={rank ? `${rank}, ${show.title}` : show.title}
        onPress={() => openShow(show, d.followedId(show))}
        style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", gap: 12, opacity: pressed ? 0.7 : 1 })}
      >
        {rank !== undefined ? <Rank>{rank}</Rank> : null}
        <Cover path={show.thumbUrl ?? show.artworkUrl} title={show.title} size={48} radius={8} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 15 }}>
            {show.title}
          </Text>
          {show.author ? (
            <Text variant="small" numberOfLines={1} style={{ color: t.muted }}>
              {show.author}
            </Text>
          ) : null}
          {sub ? (
            <Text variant="small" numberOfLines={1} style={{ color: t.muted }}>
              {sub}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <SubscribeToggle show={show} />
    </View>
  );
}

function Rank({ children }: { children: number }) {
  const t = useTheme();
  return <Text style={{ width: 22, textAlign: "right", fontFamily: fonts.extrabold, fontSize: 15, color: t.muted, fontVariant: ["tabular-nums"] }}>{children}</Text>;
}

/** Rows' placeholders, in the rows' own layout. */
export function DirectoryRowBones({ count, rank = false }: { count: number; rank?: boolean }) {
  return (
    <Skeleton>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 }}>
          {rank ? <Bone width={14} height={14} style={{ marginLeft: 8 }} /> : null}
          <Bone width={48} height={48} radius={8} />
          <View style={{ flex: 1, gap: 8 }}>
            <Bone width={i % 2 ? "62%" : "78%"} height={14} />
            <Bone width="40%" height={11} />
          </View>
          <View style={{ width: 44, alignItems: "center" }}>
            <Bone width={22} height={22} radius={11} />
          </View>
        </View>
      ))}
    </Skeleton>
  );
}

/** Says the directory couldn't be reached (or `title`, the server's words), with Try again. */
export function DirectoryError({ title = "Can't reach the podcast directory", onRetry, children }: { title?: string; onRetry: () => void; children?: React.ReactNode }) {
  return (
    <View style={{ alignItems: "center" }}>
      <Empty title={title}>{children}</Empty>
      <Button label="Try again" kind="secondary" onPress={onRetry} />
    </View>
  );
}

/** A show page's or preview's More like tab: what the show recommends, then similar shows, as rows. */
export function MoreLikeList({ feedUrl }: { feedUrl: string }) {
  const t = useTheme();
  const more = useMoreLike(feedUrl);
  if (!more.data) {
    return more.isError ? <DirectoryError title={errorText(more.error)} onRetry={() => void more.refetch()} /> : <DirectoryRowBones count={8} />;
  }
  const { recommended, similar } = more.data;
  if (!recommended.length && !similar.length) return <Empty>No similar shows found.</Empty>;
  const sub = (title: string) => <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: t.muted, marginTop: 18, marginBottom: 2 }}>{title}</Text>;
  const rows = (shows: PodcastSearchResult[]) => shows.map((s) => <DirectoryRow key={s.feedUrl} show={s} />);
  return (
    <DirectoryProvider>
      <FadeIn>
        {recommended.length ? (
          <>
            {sub("Recommended by the show")}
            {rows(recommended)}
            {similar.length ? sub("Similar shows") : null}
          </>
        ) : null}
        {rows(similar)}
      </FadeIn>
    </DirectoryProvider>
  );
}

/** What the box finds, under it. */
function BoxResults({ results }: { results: BoxFound }) {
  if (results.state === "loading") return <DirectoryRowBones count={results.link ? 1 : 6} />;
  if (results.state === "error") return <Empty>{results.message}</Empty>;
  if (!results.shows.length) return <Empty>{`Nothing matches "${results.term}".`}</Empty>;
  return (
    <View>
      {results.shows.map((r) => (
        <DirectoryRow key={r.feedUrl} show={r} sub={r.episodeCount ? plural(r.episodeCount, "episode") : null} />
      ))}
    </View>
  );
}

const openTopShows = (genreId?: number) => router.push({ pathname: "/top-shows", params: genreId ? { genre: String(genreId) } : {} });

/** More like shelves, the top shows and the categories, while the box is empty. Nothing on a server from before Browse. */
function BrowseHome() {
  const t = useTheme();
  const browse = useBrowse();
  const shelfWidth = useShelfWidth();
  const { width } = useWindowDimensions();
  const tileWidth = Math.floor((width - PAD * 2 - 12) / 2);

  if (browse.data === null) return null;
  if (browse.isError && !browse.data) {
    return <DirectoryError onRetry={() => void browse.refetch()}>You can still paste a feed link above.</DirectoryError>;
  }

  const data = browse.data;
  return (
    <>
      {!data ? (
        <Skeleton>
          <SectionBone width={170} />
          <View style={{ flexDirection: "row", gap: 14 }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ width: shelfWidth, gap: 6 }}>
                <Bone width={shelfWidth} height={shelfWidth} radius={10} />
                <Bone width="80%" height={13} />
              </View>
            ))}
          </View>
          <SectionBone width={110} />
          <DirectoryRowBones count={BROWSE_TOP_SIZE} rank />
        </Skeleton>
      ) : (
        <FadeIn>
          {data.moreLike.map((m) => (
            <View key={m.podcastId} style={{ marginTop: 24 }}>
              {/* Opens the show on its More like tab, with more of them. */}
              <SectionHead title={`More like ${m.title}`} onOpen={() => router.push({ pathname: "/show/[id]", params: { id: m.podcastId, tab: "morelike" } })} />
              <Shelf>
                {m.shows.map((s) => (
                  <DirectoryCard key={s.feedUrl} show={s} width={shelfWidth} />
                ))}
              </Shelf>
            </View>
          ))}
          {data.top.length ? (
            <View style={{ marginTop: 24 }}>
              <SectionHead title="Top shows" onOpen={() => openTopShows()} />
              {data.top.slice(0, BROWSE_TOP_SIZE).map((s, i) => (
                <DirectoryRow key={s.feedUrl} show={s} rank={i + 1} />
              ))}
            </View>
          ) : null}
        </FadeIn>
      )}

      <SectionTitle title="Categories" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {PODCAST_GENRES.map((g) => (
          <Pressable
            key={g.id}
            accessibilityRole="button"
            onPress={() => openTopShows(g.id)}
            style={({ pressed }) => ({
              width: tileWidth,
              height: 64,
              paddingHorizontal: 16,
              borderRadius: 14,
              justifyContent: "center",
              backgroundColor: pressed ? t.surface2 : t.surface,
            })}
          >
            <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 15 }}>
              {g.name}
            </Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

/**
 * Browse under its box: what the box finds while it has 2 letters or a link, else the shelves. The
 * shelves stay mounted while searching, so clearing the box brings them back as they were.
 */
export function BrowseBody({ query }: { query: string }) {
  const results = useBoxResults(query);
  return (
    <DirectoryProvider>
      {results ? (
        <FadeIn style={{ marginTop: 12 }}>
          <BoxResults results={results} />
        </FadeIn>
      ) : null}
      <View style={results ? { display: "none" } : null}>
        <BrowseHome />
      </View>
    </DirectoryProvider>
  );
}
