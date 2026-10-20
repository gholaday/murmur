import { useState } from "react";
import { ScrollView, View } from "react-native";
import { PAD } from "@/components/library";
import { PageTitle, SectionTitle, useTopInset } from "@/components/page";
import { Card, EpisodeCacheSection, LibrarySection, PasswordRow, RolePill, Row, SmallButton, UsersSection } from "@/components/settings";
import { ConfirmSheet } from "@/components/sheet";
import { Chip } from "@/components/ui";
import { useSession } from "@/lib/session";
import { AD_MODES, adPrefsStore, useAdDetection, useAdPrefs } from "@/player/ad-prefs";
import { setSkip, usePlayer } from "@/player/engine";
import { setThemeMode, useTheme, useThemeMode, type ThemeMode } from "@/theme";

const THEMES: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "System" },
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
];
const BACK_OPTIONS = [5, 10, 15, 30];
const FORWARD_OPTIONS = [10, 15, 30, 45, 60];

export default function Settings() {
  const t = useTheme();
  const top = useTopInset();
  const session = useSession();
  const mode = useThemeMode();
  const { skip } = usePlayer();
  const adPrefs = useAdPrefs();
  const adDetection = useAdDetection();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const user = session.user;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: 32 }}>
        <PageTitle title="Settings" sub={user?.username} />

        <SectionTitle title="Account" />
        <Card>
          <Row title={user?.username ?? ""} sub={session.serverUrl ?? ""}>
            <RolePill admin={!!user?.isAdmin} />
          </Row>
          <PasswordRow />
          <Row title="Sign out" last>
            <SmallButton label="Sign out" danger onPress={() => setConfirmSignOut(true)} />
          </Row>
        </Card>

        <SectionTitle title="Appearance" />
        <Card>
          <Row title="Theme" last>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {THEMES.map((x) => (
                <Chip key={x.id} label={x.label} selected={mode === x.id} onPress={() => setThemeMode(x.id)} />
              ))}
            </View>
          </Row>
        </Card>

        <SectionTitle title="Playback" />
        <Card>
          <Row title="Skip back" stacked>
            <ChipRow values={BACK_OPTIONS} value={skip.back} onPick={(v) => setSkip({ ...skip, back: v })} />
          </Row>
          <Row title="Skip forward" stacked last={!adDetection}>
            <ChipRow values={FORWARD_OPTIONS} value={skip.forward} onPick={(v) => setSkip({ ...skip, forward: v })} />
          </Row>
          {adDetection ? (
            <Row title="Ads" sub={`This device only. ${AD_MODES.find((m) => m.id === adPrefs.mode)?.hint}.`} stacked last>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {AD_MODES.map((m) => (
                  <Chip key={m.id} label={m.label} selected={adPrefs.mode === m.id} onPress={() => adPrefsStore.set({ ...adPrefs, mode: m.id })} />
                ))}
              </View>
            </Row>
          ) : null}
        </Card>

        {user?.isAdmin ? (
          <>
            <SectionTitle title="Library" />
            <LibrarySection />
            <SectionTitle title="Episode cache" />
            <EpisodeCacheSection />
            <SectionTitle title="Users" />
            <UsersSection me={user} />
          </>
        ) : null}
      </ScrollView>

      <ConfirmSheet
        open={confirmSignOut}
        title="Sign out?"
        message="Your downloads stay on this phone, and your progress is saved on the server."
        confirmLabel="Sign out"
        onConfirm={() => void session.signOut()}
        onClose={() => setConfirmSignOut(false)}
      />
    </View>
  );
}

function ChipRow({ values, value, onPick }: { values: number[]; value: number; onPick: (v: number) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
      {values.map((v) => (
        <Chip key={v} label={`${v}s`} selected={v === value} onPress={() => onPick(v)} />
      ))}
    </View>
  );
}
