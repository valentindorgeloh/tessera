import { Suspense } from "react";
import { io } from "next/cache";
import { notFound } from "next/navigation";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/Stack";
import { AnalyticsScreen } from "@/components/analytics/AnalyticsScreen";
import type { AnalyticsSearch } from "@/components/analytics/types";
import { AnalyticsTabSchema, analyticsSearchKey, parseAnalyticsParams } from "@/components/charts/analytics-format";
import { isTrackerError } from "@/lib/tessera/server";
import { loadAnalytics } from "./load";

type Props = {
  params: Promise<{ tab: string }>;
  searchParams: Promise<AnalyticsSearch>;
};

/**
 * `/analytics/<tab>` (docs/drafts/p9-plan.md U4). The shell suspends, then
 * the child awaits the route, `io()`, and one read. Filters are the query.
 */
export default function AnalyticsTabPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<AnalyticsSkeleton />}>
      <AnalyticsData params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function AnalyticsData({ params, searchParams }: Props) {
  const [route, query] = await Promise.all([params, searchParams]);
  await io();
  const tab = AnalyticsTabSchema.safeParse(route.tab);
  if (!tab.success) notFound();
  const requested = parseAnalyticsParams(query);
  let loaded: Awaited<ReturnType<typeof loadAnalytics>> | undefined;
  let missing = false;
  try {
    loaded = await loadAnalytics(tab.data, requested);
  } catch (err) {
    if (isTrackerError(err) && err.code === "NOT_FOUND") missing = true;
    else throw err;
  }
  if (missing || loaded === undefined) notFound();
  return (
    <AnalyticsScreen
      key={analyticsSearchKey(tab.data, query)}
      tab={tab.data}
      result={loaded.result}
      projects={loaded.projects}
      filters={loaded.filters}
      digest={loaded.digest}
      today={loaded.today}
    />
  );
}

function AnalyticsSkeleton() {
  return (
    <VStack gap={4} padding={6} aria-busy="true" aria-label="Loading analytics">
      <Skeleton height="var(--size-element-md)" width="40%" />
      <Skeleton height="var(--size-element-lg)" index={1} />
      <Skeleton height={240} index={2} />
    </VStack>
  );
}
