import { statsKindsShown } from "@murmur/shared";
import { getContext } from "@/server/context";
import { getPrefs } from "@/server/prefs";
import { requirePageUser } from "@/server/session";
import { StatsPage } from "@/web/profile/stats";

/** Stats, opened from the card on You. */
export default async function YouStatsPage() {
  const user = await requirePageUser();
  return <StatsPage kinds={statsKindsShown(getPrefs(await getContext(), user.id).tabs)} />;
}
