"use client";

/**
 * Analytics (docs/drafts/p9-plan.md U4). Tabs keep the query. The project
 * filter and the range write the URL with `router.replace`; the page
 * re-reads `searchParams`, so nothing calls `router.refresh`.
 */
import { useRouter } from "next/navigation";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { MultiSelector, type MultiSelectorOptionData } from "@astryxdesign/core/MultiSelector";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { VStack } from "@astryxdesign/core/Stack";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { CyclesPanel, ModulesPanel } from "@/components/analytics/PlanningPanels";
import { NarrativeCard } from "@/components/analytics/NarrativeCard";
import { OverviewPanel } from "@/components/analytics/OverviewPanel";
import { WorkItemsPanel } from "@/components/analytics/WorkItemsPanel";
import type { AnalyticsFilters, AnalyticsProjectOption, AnalyticsResult, AnalyticsTab } from "@/components/analytics/types";
import { ANALYTICS_RANGES, ANALYTICS_TABS } from "@/components/analytics/types";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import {
  AnalyticsRangeSchema,
  RANGE_LABELS,
  TAB_LABELS,
  analyticsHref,
  isCyclesResult,
  isModulesResult,
  isOverviewResult,
  isWorkItemsResult,
  pointsAvailable,
} from "@/components/charts/analytics-format";
import type { DigestView } from "@/lib/tessera/types";

export type AnalyticsScreenProps = {
  tab: AnalyticsTab;
  result: AnalyticsResult | null;
  projects: readonly AnalyticsProjectOption[];
  filters: AnalyticsFilters;
  digest: DigestView | null;
  /** Server local date, for chart ticks and KPI links (decision 6). */
  today: string;
};

export function AnalyticsScreen({ tab, result, projects, filters, digest, today }: AnalyticsScreenProps) {
  const router = useRouter();
  const pointsOk = pointsAvailable(projects, filters.projectIds);
  const options: MultiSelectorOptionData[] = projects.map((project) => ({
    value: project.id,
    label: project.name,
    description: project.identifier,
  }));

  const write = (next: AnalyticsFilters, nextTab: AnalyticsTab = tab) => {
    router.replace(analyticsHref(nextTab, next), { scroll: false });
  };

  const setProjects = (ids: string[]) => {
    const xAxis = filters.xAxis === "state" && ids.length !== 1 ? "state_group" : filters.xAxis;
    const segment = filters.segment === xAxis ? null : filters.segment;
    const measure = filters.measure === "points" && !pointsAvailable(projects, ids) ? "count" : filters.measure;
    write({ ...filters, projectIds: ids, xAxis, segment, measure });
  };

  return (
    <PanelPage
      header={
        <PanelHeader label="Analytics">
          <PanelBar
            tabsBelow
            className="tessera-analytics-header"
            start={
              <>
                <PanelTitle className="tessera-analytics-title">Analytics</PanelTitle>
                <TabList value={tab} onChange={() => {}} size="sm" layout="hug" aria-label="Analytics" className="tessera-analytics-tabs">
                  {ANALYTICS_TABS.map((item) => (
                    <Tab key={item} value={item} label={TAB_LABELS[item]} href={analyticsHref(item, filters)} />
                  ))}
                </TabList>
              </>
            }
            end={
              <>
                <MultiSelector
                  label="Projects"
                  isLabelHidden
                  size="sm"
                  options={options}
                  value={filters.projectIds}
                  onChange={setProjects}
                  placeholder="All projects"
                  hasClear
                  hasSearch={options.length > 8}
                  controlClassName="tessera-analytics-projects"
                />
                <SegmentedControl
                  label="Range"
                  size="sm"
                  value={filters.range}
                  onChange={(value) => {
                    const parsed = AnalyticsRangeSchema.safeParse(value);
                    if (parsed.success) write({ ...filters, range: parsed.data });
                  }}
                >
                  {ANALYTICS_RANGES.map((range) => (
                    <SegmentedControlItem key={range} value={range} label={RANGE_LABELS[range]} />
                  ))}
                </SegmentedControl>
              </>
            }
          />
        </PanelHeader>
      }
    >
      <VStack gap={6} padding={4}>
        <NarrativeCard tab={tab} filters={filters} digest={digest} />
        <AnalyticsBody tab={tab} result={result} filters={filters} pointsOk={pointsOk} today={today} onChange={write} />
      </VStack>
    </PanelPage>
  );
}

function AnalyticsBody({
  tab,
  result,
  filters,
  pointsOk,
  today,
  onChange,
}: {
  tab: AnalyticsTab;
  result: AnalyticsResult | null;
  filters: AnalyticsFilters;
  pointsOk: boolean;
  today: string;
  onChange: (next: AnalyticsFilters) => void;
}) {
  if (result === null) {
    return <EmptyState title="No analytics yet" description="Counts appear here once analytics is available." headingLevel={2} />;
  }
  if (tab === "overview" && isOverviewResult(result)) {
    return <OverviewPanel result={result} projectIds={filters.projectIds} today={today} />;
  }
  if (tab === "work-items" && isWorkItemsResult(result)) {
    return <WorkItemsPanel result={result} filters={filters} pointsOk={pointsOk} today={today} onChange={onChange} />;
  }
  if (tab === "cycles" && isCyclesResult(result)) {
    return <CyclesPanel result={result} today={today} />;
  }
  if (tab === "modules" && isModulesResult(result)) {
    return <ModulesPanel result={result} today={today} />;
  }
  return <EmptyState title="No analytics yet" description="Counts appear here once analytics is available." headingLevel={2} />;
}
