import { View } from "react-native";
import { NestedScreen, PageTitle } from "./page";
import { LinkRow } from "./settings";

/** One settings group's own screen, opened from its row on the You tab. */
export function SettingsPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <NestedScreen>
      <PageTitle title={title} />
      <View style={{ marginTop: 16 }}>{children}</View>
    </NestedScreen>
  );
}

/** A row on the You tab that opens a settings screen, with its current value when there's a short one. */
export const NavRow = LinkRow;
