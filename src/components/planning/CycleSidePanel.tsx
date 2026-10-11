"use client";

/**
 * Progress side panel of the cycle detail (docs/contracts/ui.md "Cycles
 * (E1)"): the shared ProgressPanel with the chart block, a Burndown / Burnup
 * switch and, only when the cycle has points progress, a Work items / Points
 * switch. Both choices persist in the planning panel preferences; the unit in
 * use is `effectiveUnit`, so a stored "points" waits for a cycle that has
 * points. Visible text says "work items", never the engine's "issues".
 */
import { LayoutPanel } from "@astryxdesign/core/Layout";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import type { CycleDetail, CycleProgress } from "@/lib/tessera/types";
import { BurndownIcon, BurnupIcon } from "@/themes/catppuccin/icons";
import { BurndownChart } from "./BurndownChart";
import { effectiveUnit } from "./burndown";
import { savePanelPrefs, usePanelPrefs } from "./panel-prefs";
import { ProgressPanel } from "./ProgressPanel";

export type CycleSidePanelProps = {
  cycle: CycleDetail;
  pointsProgress: CycleProgress | null;
  today: string;
  /** Draft chart action: opens the edit dialog (open cycles only). */
  onAddDates?: () => void;
};

export function CycleSidePanel({ cycle, pointsProgress, today, onAddDates }: CycleSidePanelProps) {
  const prefs = usePanelPrefs();
  const unit = effectiveUnit(prefs.unit, pointsProgress !== null);
  const progress = unit === "points" && pointsProgress ? pointsProgress : cycle.progress;

  const chart = (
    <VStack gap={3}>
      <HStack gap={2} wrap="wrap" vAlign="center">
        <SegmentedControl label="Chart" size="sm" value={prefs.chart} onChange={(value) => savePanelPrefs({ chart: value === "burnup" ? "burnup" : "burndown" })}>
          <SegmentedControlItem value="burndown" label="Burndown" icon={<BurndownIcon />} />
          <SegmentedControlItem value="burnup" label="Burnup" icon={<BurnupIcon />} />
        </SegmentedControl>
        {pointsProgress !== null ? (
          <SegmentedControl label="Unit" size="sm" value={unit} onChange={(value) => savePanelPrefs({ unit: value === "points" ? "points" : "issues" })}>
            <SegmentedControlItem value="issues" label="Work items" />
            <SegmentedControlItem value="points" label="Points" />
          </SegmentedControl>
        ) : null}
      </HStack>
      <BurndownChart cycle={cycle} progress={progress} kind={prefs.chart} today={today} onAddDates={onAddDates} />
    </VStack>
  );

  return (
    <LayoutPanel width={360} hasDivider padding={4} isScrollable label="Cycle progress" role="complementary">
      <ProgressPanel
        title="Progress"
        counts={cycle.progress}
        points={pointsProgress?.points}
        byState={cycle.progress.by_state}
        assignees={cycle.progress.assignees}
        labels={cycle.progress.labels}
        byAssignee={cycle.progress.by_assignee}
        byLabel={cycle.progress.by_label}
        includesArchived
        isFrozen={cycle.progress_snapshot !== null}
        chart={chart}
      />
    </LayoutPanel>
  );
}
