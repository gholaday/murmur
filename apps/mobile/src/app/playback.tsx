import { QUALITY_LABEL, SKIP_BACK_OPTIONS, SKIP_FORWARD_OPTIONS, type VideoQuality } from "@murmur/shared/client";
import { Card, Row, SwitchRow } from "@/components/settings";
import { SettingsPage } from "@/components/settings-page";
import { Chips } from "@/components/ui";
import { saveAutoplayNext, saveVideoQuality, useAutoplayNext, useVideoQuality } from "@/lib/data";
import { useWatchHome } from "@/lib/watch";
import { AD_MODES, adPrefsStore, useAdDetection, useAdPrefs } from "@/player/ad-prefs";
import { setSkip, usePlayer } from "@/player/engine";

const seconds = (values: readonly number[]) => values.map((v) => ({ id: v, label: `${v}s` }));
const SKIP_BACK = seconds(SKIP_BACK_OPTIONS);
const SKIP_FORWARD = seconds(SKIP_FORWARD_OPTIONS);
const QUALITIES = (["full", "light"] as const).map((id) => ({ id, label: QUALITY_LABEL[id] }));

/** Skip lengths, the quality of converted video, and what happens at ads when the server finds them. */
export default function PlaybackSettings() {
  const { skip } = usePlayer();
  const adPrefs = useAdPrefs();
  const adDetection = useAdDetection();
  const watch = !!useWatchHome().data?.enabled;
  const quality = useVideoQuality();
  const autoplayNext = useAutoplayNext();
  return (
    <SettingsPage title="Playback">
      <Card>
        <Row title="Skip back" stacked>
          <Chips kind="radio" wrap options={SKIP_BACK} value={skip.back} onPick={(v) => setSkip({ ...skip, back: v })} />
        </Row>
        <Row title="Skip forward" stacked last={!watch && !adDetection}>
          <Chips kind="radio" wrap options={SKIP_FORWARD} value={skip.forward} onPick={(v) => setSkip({ ...skip, forward: v })} />
        </Row>
        {watch ? (
          <>
            <Row title="Converted video" sub="When the server has to convert a video. 720p is easier on a small server" stacked>
              <Chips kind="radio" wrap options={QUALITIES} value={quality} onPick={(q: VideoQuality) => saveVideoQuality(q)} />
            </Row>
            <SwitchRow title="Play next episode" label="Play next episode" value={autoplayNext} onChange={saveAutoplayNext} last={!adDetection} />
          </>
        ) : null}
        {adDetection ? (
          <Row title="Ads" sub={`This device only. ${AD_MODES.find((m) => m.id === adPrefs.mode)?.hint}.`} stacked last>
            <Chips kind="radio" wrap options={AD_MODES} value={adPrefs.mode} onPick={(mode) => adPrefsStore.set({ ...adPrefs, mode })} />
          </Row>
        ) : null}
      </Card>
    </SettingsPage>
  );
}
