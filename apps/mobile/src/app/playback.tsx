import { View } from "react-native";
import { SKIP_BACK_OPTIONS, SKIP_FORWARD_OPTIONS } from "@murmur/shared/client";
import { Card, Row } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";
import { Chip } from "@/components/ui";
import { AD_MODES, adPrefsStore, useAdDetection, useAdPrefs } from "@/player/ad-prefs";
import { setSkip, usePlayer } from "@/player/engine";

/** Skip lengths, and what happens at ads when the server finds them. */
export default function PlaybackSettings() {
  const { skip } = usePlayer();
  const adPrefs = useAdPrefs();
  const adDetection = useAdDetection();
  return (
    <SettingsPage title="Playback">
      <Card>
        <Row title="Skip back" stacked>
          <ChipRow values={SKIP_BACK_OPTIONS} value={skip.back} onPick={(v) => setSkip({ ...skip, back: v })} />
        </Row>
        <Row title="Skip forward" stacked last={!adDetection}>
          <ChipRow values={SKIP_FORWARD_OPTIONS} value={skip.forward} onPick={(v) => setSkip({ ...skip, forward: v })} />
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
    </SettingsPage>
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
