import { useState } from "react";
import { RefreshControl } from "react-native";
import { useTheme } from "@/theme";

/**
 * Pull to refresh for a scroll view's `refreshControl`. The spinner shows only for a pull, until
 * `refetch` settles; background refetches (opening a page, coming back to the app) stay quiet.
 */
export function usePullRefresh(refetch: () => Promise<unknown>) {
  const t = useTheme();
  const [pulled, setPulled] = useState(false);
  return (
    <RefreshControl
      refreshing={pulled}
      onRefresh={() => {
        setPulled(true);
        void refetch().finally(() => setPulled(false));
      }}
      tintColor={t.accent}
      colors={[t.accent]}
    />
  );
}
