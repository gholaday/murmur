import { SKIP_BACK_OPTIONS, SKIP_FORWARD_OPTIONS } from "@murmur/shared/client";
import { Card, Row } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";
import { Chips } from "@/components/ui";
import { AD_MODES, adPrefsStore, useAdDetection, useAdPrefs } from "@/player/ad-prefs";
import { setSkip, usePlayer } from "@/player/engine";

const seconds = (values: readonly number[]) => values.map((v) => ({ id: v, label: `${v}s` }));
const SKIP_BACK = seconds(SKIP_BACK_OPTIONS);
const SKIP_FORWARD = seconds(SKIP_FORWARD_OPTIONS);

/** Skip lengths, and what happens at ads when the server finds them. */
export default function PlaybackSettings() {
  const { skip } = usePlayer();
  const adPrefs = useAdPrefs();
  const adDetection = useAdDetection();
  return (
    <SettingsPage title="Playback">
      <Card>
        <Row title="Skip back" stacked>
          <Chips kind="radio" wrap options={SKIP_BACK} value={skip.back} onPick={(v) => setSkip({ ...skip, back: v })} />
        </Row>
        <Row title="Skip forward" stacked last={!adDetection}>
          <Chips kind="radio" wrap options={SKIP_FORWARD} value={skip.forward} onPick={(v) => setSkip({ ...skip, forward: v })} />
        </Row>
        {adDetection ? (
          <Row title="Ads" sub={`This device only. ${AD_MODES.find((m) => m.id === adPrefs.mode)?.hint}.`} stacked last>
            <Chips kind="radio" wrap options={AD_MODES} value={adPrefs.mode} onPick={(mode) => adPrefsStore.set({ ...adPrefs, mode })} />
          </Row>
        ) : null}
      </Card>
    </SettingsPage>
  );
}
