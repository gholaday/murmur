"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "../toast";
import {
  androidAppUrl,
  apiPaths,
  errorText,
  type LibraryAdminDto,
  type LibraryFolderDto,
  type MusicSummaryDto,
  ONBOARDING_TITLES,
  onboardingSteps,
  plural,
  scanStatusText,
  type ScanStatusDto,
  stepLabel,
  type UserPrefs,
  type WatchSummaryDto,
} from "@murmur/shared/client";
import { api } from "../api";
import { AppIcon, ChevronIcon, CopyIcon, DownloadIcon, UploadIcon } from "../icons";
import { useOpmlImport } from "../podcasts/browse";
import { Setting, SettingsGroup, SettingSub, SwitchRow } from "../ui";

/** How often the library step checks on a scan that's running. */
const SCAN_POLL_MS = 2000;

/**
 * The first-run steps, once per person, each with Skip: what's on the server (admins), which
 * tabs to show, podcasts, and the Android app. Finishing or skipping goes to the library and
 * doesn't come back.
 */
export function Welcome({
  isAdmin,
  tabs,
  books,
  music,
  watch,
  following,
  libraryAdmin,
  folders,
  musicFolders,
  videoFolders,
  version,
  devBuild,
}: {
  isAdmin: boolean;
  tabs: UserPrefs["tabs"];
  books: number;
  music: MusicSummaryDto;
  watch: WatchSummaryDto;
  /** Shows you already follow. */
  following: number;
  libraryAdmin: LibraryAdminDto | null;
  folders: LibraryFolderDto[];
  musicFolders: LibraryFolderDto[];
  videoFolders: LibraryFolderDto[];
  version: string;
  devBuild: boolean;
}) {
  const router = useRouter();
  const steps = onboardingSteps(isAdmin, "web");
  const [step, setStep] = useState(steps[0]!);
  const [leaving, setLeaving] = useState(false);
  const last = step === steps[steps.length - 1];
  const text = ONBOARDING_TITLES[step];

  /** Marks the steps done, then goes on: to the library, or where `to` says. */
  const finish = async (to = "/") => {
    setLeaving(true);
    try {
      await api(apiPaths.prefs, { method: "PUT", body: { onboarded: true } });
      router.replace(to);
    } catch (err) {
      toast.error(errorText(err));
      setLeaving(false);
    }
  };

  return (
    <main className="welcome">
      <div className="welcome-top">
        <div className="tabs-brand welcome-brand">
          <AppIcon />
          Murmur
        </div>
        {last ? null : (
          <button type="button" className="text-btn" disabled={leaving} onClick={() => void finish()}>
            Skip
          </button>
        )}
      </div>

      <div key={step} className="welcome-step view-fade">
        <div className="eyebrow">{stepLabel(step, steps)}</div>
        <h1 className="page-title welcome-title">{text.title}</h1>
        <p className="muted welcome-sub">{text.sub}</p>

        {step === "library" && libraryAdmin ? (
          <LibraryStep admin={libraryAdmin} folders={folders} musicFolders={musicFolders} videoFolders={videoFolders} />
        ) : step === "tabs" ? (
          <TabsStep tabs={tabs} books={books} music={music} watch={watch} />
        ) : step === "podcasts" ? (
          <PodcastsStep following={following} onFind={() => void finish("/podcasts?tab=browse")} />
        ) : step === "app" ? (
          <AppStep version={version} devBuild={devBuild} />
        ) : null}
      </div>

      <div className="welcome-foot">
        <button
          type="button"
          className="btn btn-big btn-primary"
          disabled={leaving}
          onClick={() => (last ? void finish() : setStep(steps[steps.indexOf(step) + 1]!))}
        >
          {last ? "Start listening" : "Continue"}
        </button>
      </div>
    </main>
  );
}

/** Admins: the folders the server found, with how far each scan has got. */
function LibraryStep({
  admin,
  folders,
  musicFolders,
  videoFolders,
}: {
  admin: LibraryAdminDto;
  folders: LibraryFolderDto[];
  musicFolders: LibraryFolderDto[];
  videoFolders: LibraryFolderDto[];
}) {
  const router = useRouter();
  const scanning = admin.books.scan.running || admin.music.scan.running || admin.watch.scan.running;
  // While a scan runs, its counts climb here.
  useEffect(() => {
    if (!scanning) return;
    const timer = setInterval(() => router.refresh(), SCAN_POLL_MS);
    return () => clearInterval(timer);
  }, [scanning, router]);

  const row = (title: string, list: LibraryFolderDto[], scan: ScanStatusDto, count: string, empty: string) => (
    <Setting
      key={title}
      title={title}
      sub={
        list.length ? (
          <>
            {list.map((f) => (
              <span key={f.id} className="folder-path welcome-path">
                {f.path}
              </span>
            ))}
            <SettingSub error={!!scan.lastError}>{scan.running ? "Scanning now" : scanStatusText(scan)}</SettingSub>
          </>
        ) : (
          <SettingSub>{empty}</SettingSub>
        )
      }
    >
      {list.length ? <span className="setting-value set-plain">{count}</span> : null}
    </Setting>
  );

  return (
    <SettingsGroup>
      {row("Books", folders, admin.books.scan, plural(admin.books.total, "book"), "Mount your audiobooks at /audiobooks.")}
      {row("Music", musicFolders, admin.music.scan, plural(admin.music.albums, "album"), "Mount your music at /music.")}
      {row(
        "Movies and shows",
        videoFolders,
        admin.watch.scan,
        [admin.watch.movies ? plural(admin.watch.movies, "movie") : null, admin.watch.shows ? plural(admin.watch.shows, "show") : null].filter(Boolean).join(" and ") || "None yet",
        "Mount your movies at /movies and shows at /shows.",
      )}
    </SettingsGroup>
  );
}

/** Which tabs show, saved as you go, the same as Appearance in You. */
function TabsStep({ tabs, books, music, watch }: { tabs: UserPrefs["tabs"]; books: number; music: MusicSummaryDto; watch: WatchSummaryDto }) {
  const [shown, setShown] = useState(tabs);
  const toggle = (tab: keyof UserPrefs["tabs"], on: boolean) => {
    const next = { ...shown, [tab]: on };
    setShown(next);
    api(apiPaths.prefs, { method: "PUT", body: { tabs: next } }).catch((err: unknown) => {
      setShown(shown);
      toast.error(errorText(err));
    });
  };
  return (
    <SettingsGroup>
      <SwitchRow title="Books" sub={plural(books, "book")} label="Books in Library" checked={shown.books !== false} onChange={(on) => toggle("books", on)} />
      <SwitchRow title="Podcasts" sub="Follow shows by name or RSS" label="Podcasts tab" checked={shown.podcasts} onChange={(on) => toggle("podcasts", on)} />
      {music.enabled ? (
        <SwitchRow title="Music" sub={plural(music.albums, "album")} label="Music in Library" checked={!!shown.music} onChange={(on) => toggle("music", on)} />
      ) : null}
      {watch.enabled ? (
        <SwitchRow
          title="Watch"
          sub={[watch.movies ? plural(watch.movies, "movie") : null, watch.shows ? plural(watch.shows, "show") : null].filter(Boolean).join(" and ") || "Nothing found yet"}
          label="Watch in Library"
          checked={!!shown.watch}
          onChange={(on) => toggle("watch", on)}
        />
      ) : null}
    </SettingsGroup>
  );
}

function PodcastsStep({ following, onFind }: { following: number; onFind: () => void }) {
  const { busy, importOpml } = useOpmlImport();
  return (
    <SettingsGroup>
      <Setting title="Import from another app" sub={<SettingSub>An OPML file, from its export</SettingSub>}>
        <label className="btn" aria-disabled={busy || undefined}>
          <UploadIcon size={18} />
          Import
          <input
            type="file"
            accept=".opml,.xml,text/xml,application/xml"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void importOpml(f);
            }}
          />
        </label>
      </Setting>
      <button type="button" className="setting setting-link" onClick={onFind}>
        <span className="setting-text">
          <span className="setting-title">Find shows</span>
          <SettingSub>{following ? `Following ${plural(following, "show")}` : "Top charts and search"}</SettingSub>
        </span>
        <span className="setting-value">
          <ChevronIcon />
        </span>
      </button>
    </SettingsGroup>
  );
}

/** The Android app for this server, and the address to sign in with. */
function AppStep({ version, devBuild }: { version: string; devBuild: boolean }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <SettingsGroup>
      <Setting title="Android app" sub={<SettingSub>{devBuild ? "The latest release on GitHub" : `Version ${version}, from GitHub`}</SettingSub>}>
        <a className="btn" href={androidAppUrl(version, devBuild)} target="_blank" rel="noreferrer">
          <DownloadIcon size={18} />
          Download
        </a>
      </Setting>
      <Setting title="Server address" sub={<SettingSub>{origin || " "}</SettingSub>}>
        <button
          type="button"
          className="btn"
          disabled={!origin}
          onClick={() =>
            void navigator.clipboard.writeText(origin).then(
              () => toast("Copied the server address"),
              () => toast.error("Couldn't copy it. Select the address instead."),
            )
          }
        >
          <CopyIcon size={18} />
          Copy
        </button>
      </Setting>
    </SettingsGroup>
  );
}
