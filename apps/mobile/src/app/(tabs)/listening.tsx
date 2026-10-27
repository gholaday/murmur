import { View } from "react-native";
import { DownloadsView } from "@/components/downloads-view";
import { Segmented, setListeningView, useListeningView } from "@/components/listening";
import { PageTitle } from "@/components/page";
import { UpNextView } from "@/components/up-next";
import { useDownloads } from "@/lib/downloads";
import { usePlayer } from "@/player/engine";

/** Up Next and Downloaded, switched at the top. */
export default function Listening() {
  const view = useListeningView();
  const queued = usePlayer().queue.length;
  const downloaded = Object.keys(useDownloads()).length;
  const header = (
    <View style={{ gap: 10 }}>
      <PageTitle title="Listening" />
      <Segmented
        options={[
          { id: "up-next", label: "Up Next", count: queued },
          { id: "downloaded", label: "Downloaded", count: downloaded },
        ]}
        value={view}
        onChange={setListeningView}
      />
    </View>
  );
  return view === "up-next" ? <UpNextView header={header} /> : <DownloadsView header={header} />;
}
