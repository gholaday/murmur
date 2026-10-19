import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { PAD } from "@/components/library";
import { PageTitle, SectionTitle, useTopInset } from "@/components/page";
import { Sheet } from "@/components/sheet";
import { Button, Chip, Text } from "@/components/ui";
import { formatBytes, removeAllDownloads, useDownloads } from "@/lib/downloads";
import { useSession } from "@/lib/session";
import { setSkip, usePlayer } from "@/player/engine";
import { fonts, setThemeMode, useTheme, useThemeMode, type ThemeMode } from "@/theme";

const THEMES: Array<{ id: ThemeMode; label: string }> = [
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
  const downloads = useDownloads();
  const [confirm, setConfirm] = useState<null | "signOut" | "clear">(null);

  const all = Object.values(downloads);
  const bytes = all.reduce((n, d) => n + d.bytes, 0);
  const books = all.filter((d) => d.type === "book").length;
  const episodes = all.length - books;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingTop: top, paddingBottom: 32 }}>
        <PageTitle title="Settings" sub={session.user?.username} />

        <SectionTitle title="Account" />
        <Card>
          <Row title={session.user?.username ?? ""} sub={session.serverUrl ?? ""}>
            <RolePill admin={!!session.user?.isAdmin} />
          </Row>
          <Row title="Sign out" sub="You'll need your password to sign in again.">
            <SmallButton label="Sign out" danger onPress={() => setConfirm("signOut")} />
          </Row>
        </Card>

        <SectionTitle title="Appearance" />
        <Card>
          <Row title="Theme">
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
          <Row title="Skip forward" stacked>
            <ChipRow values={FORWARD_OPTIONS} value={skip.forward} onPick={(v) => setSkip({ ...skip, forward: v })} />
          </Row>
        </Card>
        <Text variant="small" style={{ marginTop: 8 }}>
          The lock screen and headset buttons always skip 10 seconds. Speed is remembered per book and per podcast.
        </Text>

        <SectionTitle title="Downloads" />
        <Card>
          <Row
            title={all.length ? formatBytes(bytes) : "Nothing downloaded"}
            sub={all.length ? [books ? `${books} ${books === 1 ? "book" : "books"}` : null, episodes ? `${episodes} ${episodes === 1 ? "episode" : "episodes"}` : null].filter(Boolean).join(" and ") : "Download books and episodes from their pages to listen offline."}
          >
            {all.length ? <SmallButton label="Remove all" danger onPress={() => setConfirm("clear")} /> : null}
          </Row>
        </Card>
      </ScrollView>

      <Sheet open={confirm !== null} onClose={() => setConfirm(null)} title={confirm === "clear" ? "Remove all downloads?" : "Sign out?"}>
        <View style={{ paddingHorizontal: 12, gap: 14, paddingBottom: 8 }}>
          <Text>
            {confirm === "clear"
              ? "Books and episodes stay on the server; only the copies on this phone are deleted."
              : "Your downloads stay on this phone, and your progress is saved on the server."}
          </Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button label="Cancel" kind="secondary" onPress={() => setConfirm(null)} style={{ flex: 1 }} />
            <Button
              label={confirm === "clear" ? "Remove" : "Sign out"}
              onPress={() => {
                if (confirm === "clear") removeAllDownloads();
                else void session.signOut();
                setConfirm(null);
              }}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </Sheet>
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <View style={{ backgroundColor: t.surface, borderRadius: 14, paddingHorizontal: 16 }}>{children}</View>;
}

function Row({ title, sub, stacked, children }: { title: string; sub?: string; stacked?: boolean; children?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: stacked ? 10 : 12,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: t.line,
        flexWrap: "wrap",
      }}
    >
      <View style={{ flexShrink: 1, gap: 2 }}>
        <Text variant="bodyStrong">{title}</Text>
        {sub ? <Text variant="small">{sub}</Text> : null}
      </View>
      {children}
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

function SmallButton({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ height: 38, paddingHorizontal: 16, borderRadius: 19, justifyContent: "center", backgroundColor: pressed ? t.surface2 : t.chip })}
    >
      <Text style={{ fontFamily: fonts.bold, fontSize: 14, color: danger ? t.danger : t.text }}>{label}</Text>
    </Pressable>
  );
}

function RolePill({ admin }: { admin: boolean }) {
  const t = useTheme();
  return (
    <View style={{ height: 24, paddingHorizontal: 10, borderRadius: 12, justifyContent: "center", backgroundColor: admin ? t.accent : t.chip }}>
      <Text style={{ fontFamily: fonts.bold, fontSize: 12, color: admin ? t.onAccent : t.muted }}>{admin ? "Admin" : "Listener"}</Text>
    </View>
  );
}
