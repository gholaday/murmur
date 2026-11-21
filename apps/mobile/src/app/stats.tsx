import { NestedScreen } from "@/components/page";
import { StatsBoundary, StatsPage } from "@/components/stats";

/** Your listening by week, month, year and all time, opened from the card on You. */
export default function StatsScreen() {
  return (
    <NestedScreen title="Stats">
      <StatsBoundary>
        <StatsPage />
      </StatsBoundary>
    </NestedScreen>
  );
}
