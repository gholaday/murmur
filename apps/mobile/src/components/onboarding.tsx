import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  errorText,
  type LibraryFolderDto,
  ONBOARDING_TITLES,
  onboardingSteps,
  plural,
  type ScanKind,
  type ScanStatusDto,
  scanStatusText,
  stepLabel,
} from "@murmur/shared/client";
import { finishOnboarding, importOpml, saveTabPrefs, useBooks, useMusicSummary, usePodcasts, useTabPrefs } from "@/lib/data";
import { useSession } from "@/lib/session";
import { useMovies, useShows, useWatchHome } from "@/lib/watch";
import { fonts, useTheme } from "@/theme";
import { Logo, UploadIcon } from "./icons";
import { PAD } from "./library";
import { Group, OnOffRow, RowAction, ScanBar, SetRow, Sub, useFolders, useLibraryAdmin, Value } from "./settings";
import { FadeIn } from "./skeleton";
import { toast } from "./toast";
import { Button, Caption, Text } from "./ui";

/**
 * The first-run steps, once per account, like the web's /welcome: what's on the server (admins),
 * which tabs to show, and podcasts. Skip on every step but the last; finishing or skipping goes
 * to the tabs and doesn't come back.
 */
export function Onboarding() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const admin = !!useSession().user?.isAdmin;
  const steps = onboardingSteps(admin, "app");
  const [step, setStep] = useState(steps[0]!);
  const [leaving, setLeaving] = useState(false);
  const last = step === steps[steps.length - 1];
  const text = ONBOARDING_TITLES[step];

  /** Marks the steps done; the tabs take over. `browse` opens Podcasts on Browse. */
  const finish = async (browse = false) => {
    setLeaving(true);
    try {
      await finishOnboarding();
      if (browse) requestAnimationFrame(() => router.navigate({ pathname: "/podcasts", params: { tab: "browse" } }));
    } catch (err) {
      toast.error(errorText(err));
      setLeaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: PAD, minHeight: 44 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Logo color={t.accent} width={28} />
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 17, color: t.text }}>Murmur</Text>
        </View>
        {last ? null : (
          <Pressable accessibilityRole="button" disabled={leaving} onPress={() => void finish()} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: t.accent }}>Skip</Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: 28, paddingBottom: 24 }}>
        <FadeIn key={step}>
          <Caption style={{ fontFamily: fonts.bold, letterSpacing: 0.6 }}>{stepLabel(step, steps)}</Caption>
          <Text accessibilityRole="header" style={{ marginTop: 6, fontFamily: fonts.extrabold, fontSize: 28, lineHeight: 36, letterSpacing: -0.4, color: t.text }}>
            {text.title}
          </Text>
          <Text style={{ marginTop: 6, fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: t.muted }}>{text.sub}</Text>
          {/* The steps' groups have no label, so this keeps them a labelled group's distance down. */}
          <View style={{ marginTop: 20 }}>
            {step === "library" ? <LibraryStep /> : step === "tabs" ? <TabsStep /> : step === "podcasts" ? <PodcastsStep onFind={() => void finish(true)} /> : null}
          </View>
        </FadeIn>
      </ScrollView>

      <View style={{ paddingHorizontal: PAD, paddingTop: 12, paddingBottom: insets.bottom + 16 }}>
        <Button
          label={last ? "Start listening" : "Continue"}
          disabled={leaving}
          onPress={() => (last ? void finish() : setStep(steps[steps.indexOf(step) + 1]!))}
        />
      </View>
    </View>
  );
}

/** Admins: the folders the server found, with how far each scan has got. The counts climb while one runs. */
function LibraryStep() {
  const a = useLibraryAdmin().data;
  const folders = [useFolders("books"), useFolders("music"), useFolders("movies"), useFolders("shows")];
  // Waits for every list, so a kind doesn't flash "Mount your…" before its folders arrive.
  if (!a || folders.some((f) => f.isPending)) return null;
  const [books, music, movies, shows] = folders.map((f) => f.data ?? []) as [LibraryFolderDto[], LibraryFolderDto[], LibraryFolderDto[], LibraryFolderDto[]];
  const video = [...movies, ...shows];
  const watchCount = [a.watch.movies ? plural(a.watch.movies, "movie") : null, a.watch.shows ? plural(a.watch.shows, "show") : null].filter(Boolean).join(" and ") || "None yet";
  return (
    <Group>
      <KindRow kind="books" title="Books" list={books} scan={a.books.scan} count={plural(a.books.total, "book")} empty="Mount your audiobooks at /audiobooks." />
      <KindRow kind="music" title="Music" list={music} scan={a.music.scan} count={plural(a.music.albums, "album")} empty="Mount your music at /music." />
      <KindRow kind="watch" title="Movies and shows" list={video} scan={a.watch.scan} count={watchCount} empty="Mount your movies at /movies and shows at /shows." />
    </Group>
  );
}

function KindRow({ kind, title, list, scan, count, empty }: { kind: ScanKind; title: string; list: LibraryFolderDto[]; scan: ScanStatusDto; count: string; empty: string }) {
  const t = useTheme();
  return (
    <View>
      <SetRow
        title={title}
        sub={
          list.length ? (
            <>
              {list.map((f) => (
                <Text key={f.id} numberOfLines={1} style={{ fontFamily: fonts.medium, fontSize: 12, color: t.muted }}>
                  {f.path}
                </Text>
              ))}
              <Sub danger={!scan.running && !!scan.lastError}>{scanStatusText(scan, kind)}</Sub>
            </>
          ) : (
            <Sub>{empty}</Sub>
          )
        }
      >
        {list.length ? <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: t.muted }}>{count}</Text> : null}
      </SetRow>
      {list.length ? <ScanBar scan={scan} /> : null}
    </View>
  );
}

/** Which tabs show, saved as you go, the same as You > Appearance. */
function TabsStep() {
  const tabs = useTabPrefs();
  const books = useBooks().data?.filter((b) => b.missingSince === null).length ?? 0;
  const music = useMusicSummary().data;
  const hasWatch = !!useWatchHome().data?.enabled;
  const movies = useMovies(hasWatch).data?.length ?? 0;
  const shows = useShows(hasWatch).data?.length ?? 0;
  return (
    <Group>
      <OnOffRow title="Books" sub={plural(books, "book")} value={tabs.books} onChange={(on) => saveTabPrefs({ ...tabs, books: on })} />
      <OnOffRow title="Podcasts" sub="Follow shows by name or RSS" value={tabs.podcasts} onChange={(podcasts) => saveTabPrefs({ ...tabs, podcasts })} />
      {music?.enabled ? <OnOffRow title="Music" sub={plural(music.albums, "album")} value={tabs.music} onChange={(on) => saveTabPrefs({ ...tabs, music: on })} /> : null}
      {hasWatch ? (
        <OnOffRow
          title="Watch"
          sub={[movies ? plural(movies, "movie") : null, shows ? plural(shows, "show") : null].filter(Boolean).join(" and ") || "Nothing found yet"}
          value={tabs.watch}
          onChange={(on) => saveTabPrefs({ ...tabs, watch: on })}
        />
      ) : null}
    </Group>
  );
}

function PodcastsStep({ onFind }: { onFind: () => void }) {
  const t = useTheme();
  const following = usePodcasts().data?.length ?? 0;
  const [busy, setBusy] = useState(false);
  return (
    <Group>
      <SetRow title="Import from another app" sub="An OPML file, from its export">
        <RowAction
          label="Import"
          icon={<UploadIcon size={18} color={t.accent} />}
          disabled={busy}
          onPress={() => {
            setBusy(true);
            void importOpml().finally(() => setBusy(false));
          }}
        />
      </SetRow>
      <SetRow title="Find shows" sub={following ? `Following ${plural(following, "show")}` : "Top charts and search"} onPress={onFind}>
        <Value />
      </SetRow>
    </Group>
  );
}
