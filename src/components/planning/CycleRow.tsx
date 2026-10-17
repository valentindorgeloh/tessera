"use client";

/**
 * One cycle in the cycles list (docs/contracts/ui.md "Cycles (E1)"). The row
 * links to the cycle through ListItem's invisible anchor, so the menu in
 * `endContent` is a sibling of the link, never nested in it.
 */
import { Badge } from "@astryxdesign/core/Badge";
import { ListItem } from "@astryxdesign/core/List";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { HStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import type { Cycle } from "@/lib/tessera/types";
import { CYCLE_STATUS_LABEL, cycleStatusVariant, daysLeftLabel, formatCycleRange } from "./cycle-format";
import { CycleMenu } from "./CycleMenu";
import { moduleProgressText, moduleProgressValues } from "./module-format";

export type CycleRowProps = { projectId: string; cycle: Cycle; today: string };

/** "Mar 1 – Mar 14", plus " · 5 days left" for the current cycle. */
export function cycleRowDescription(cycle: Pick<Cycle, "start_date" | "end_date" | "status">, today: string): string {
  const range = formatCycleRange(cycle.start_date, cycle.end_date, today);
  return cycle.status === "current" && cycle.end_date ? `${range} · ${daysLeftLabel(cycle.end_date, today)}` : range;
}

export function CycleRow({ projectId, cycle, today }: CycleRowProps) {
  // completed / (total - cancelled), the numbers of the progress panel and the module rows (module-format.ts).
  const { value, max } = moduleProgressValues(cycle.progress);
  return (
    <ListItem
      href={`/projects/${projectId}/cycles/${cycle.id}`}
      startContent={<StatusDot variant={cycleStatusVariant(cycle.status)} label={CYCLE_STATUS_LABEL[cycle.status]} />}
      label={cycle.name}
      description={cycleRowDescription(cycle, today)}
      endContent={
        <HStack gap={3} vAlign="center" className="tessera-planning-row-end">
          {cycle.status === "completed" && cycle.open_count > 0 ? <Badge variant="warning" label={`${cycle.open_count} open`} /> : null}
          <Text type="supporting" hasTabularNumbers>
            {moduleProgressText(cycle.progress)}
          </Text>
          <ProgressBar className="tessera-planning-cycle-bar" isLabelHidden label={`${cycle.name} progress`} variant="success" value={value} max={Math.max(max, 1)} />
          <CycleMenu projectId={projectId} cycle={cycle} today={today} />
        </HStack>
      }
    />
  );
}
