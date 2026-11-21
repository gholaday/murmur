import { View } from "react-native";
import { type HiddenItem, LIBRARY_SECTION_LABELS, type LibrarySection } from "@murmur/shared/client";
import { Cover } from "@/components/cover";
import { Empty, NestedScreen, SectionTitle } from "@/components/page";
import { usePullRefresh } from "@/components/pull-refresh";
import { SmallButton } from "@/components/settings";
import { FadeIn, ListRowBone, Skeleton, useJustLoaded } from "@/components/skeleton";
import { Text } from "@/components/ui";
import { unhideRow, useHidden } from "@/lib/hidden";
import { useTheme } from "@/theme";

const SECTIONS: LibrarySection[] = ["books", "music", "watch"];

/** You > Hidden: what you've taken out of your lists, by Library section, each with Unhide. */
export default function HiddenScreen() {
  const hidden = useHidden();
  const refresh = usePullRefresh(hidden.refetch);
  const fade = useJustLoaded(!hidden.isPending);
  const d = hidden.data;
  const shown = d ? SECTIONS.filter((s) => d[s].length) : [];

  let body: React.ReactNode;
  if (d) {
    body = shown.length ? (
      <FadeIn when={fade}>
        {shown.map((s) => (
          <View key={s}>
            <SectionTitle title={LIBRARY_SECTION_LABELS[s]} count={d[s].length} />
            {d[s].map((item) => (
              <HiddenRow key={`${item.kind}:${item.id}`} item={item} section={s} />
            ))}
          </View>
        ))}
      </FadeIn>
    ) : (
      <Empty title="Nothing hidden" />
    );
  } else if (d === null) {
    // A server from before hiding; You doesn't link here then.
    body = <Empty title="Nothing hidden" />;
  } else if (hidden.isError) {
    body = <Empty title="Couldn't load what's hidden">{hidden.error.message}</Empty>;
  } else {
    body = (
      <Skeleton style={{ marginTop: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <ListRowBone key={i} thumb={44} buttons={1} />
        ))}
      </Skeleton>
    );
  }

  return (
    <NestedScreen title="Hidden" refreshControl={refresh}>
      {body}
    </NestedScreen>
  );
}

/** Its picture (round for an artist), title and line, and Unhide. */
function HiddenRow({ item, section }: { item: HiddenItem; section: LibrarySection }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 64, borderBottomWidth: 1, borderBottomColor: t.line }}>
      <Cover path={item.image} title={item.title} color={item.color} size={44} radius={item.kind === "artist" ? 22 : 8} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {item.title}
        </Text>
        <Text variant="small" numberOfLines={1}>
          {item.sub}
        </Text>
      </View>
      <SmallButton label="Unhide" onPress={() => void unhideRow(item, section)} />
    </View>
  );
}
