"use client";

/**
 * Stored analytics digest (docs/drafts/p9-plan.md U4, decision 37). The card
 * reads a digest the page already loaded. Summarise posts only after a
 * click, and only once the digest kind includes analytics.
 */
import { DigestCard } from "@/components/ai/DigestCard";
import type { AnalyticsFilters, AnalyticsTab } from "@/components/analytics/types";
import { narrativeId } from "@/components/charts/analytics-format";
import { DigestKindSchema } from "@/lib/tessera/schemas";
import type { DigestView } from "@/lib/tessera/types";

export function NarrativeCard({ tab, filters, digest }: { tab: AnalyticsTab; filters: AnalyticsFilters; digest: DigestView | null }) {
  const parsed = DigestKindSchema.safeParse("analytics");
  if (!parsed.success) return null;
  return <DigestCard kind={parsed.data} id={narrativeId(tab, filters)} digest={digest} />;
}
