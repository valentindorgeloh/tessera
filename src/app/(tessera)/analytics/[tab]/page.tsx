import { io } from "next/cache";
import { notFound } from "next/navigation";
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
 * `instant = false`: this page keeps no Suspense boundary of its own and
 * blocks (decision 156). A client navigation keeps the old page on screen
 * until this one is ready, so React never commits a skeleton and holds the
 * content for 300 ms, and a full load sends the page in the first HTML flush
 * instead of a streamed segment. The opt-out allows the blocking route and
 * turns off dev validation of instant navigation for this segment
 * (`02-route-segment-config/instant.md`).
 */
export const instant = false;

/**
 * `/analytics/<tab>` (docs/drafts/p9-plan.md U4). The page blocks while the
 * child awaits the route, `io()`, and one read. Filters are the query.
 */
export default function AnalyticsTabPage({ params, searchParams }: Props) {
  return <AnalyticsData params={params} searchParams={searchParams} />;
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
