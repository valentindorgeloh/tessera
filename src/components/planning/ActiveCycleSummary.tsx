"use client";

/**
 * Card for the current cycle on the cycles list (docs/contracts/ui.md
 * "Cycles (E1)"): name, range, days left, the completed bar, the counts by
 * state group and a compact chart (its text summary stays; no data table),
 * with a link into the cycle. The chart follows the panel's stored chart and
 * unit preferences.
 */
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { stateGroupLabel, stateGroupVariant } from "@/components/work-items/properties";
import type { StateGroup } from "@/lib/tessera/types";
import { CalendarDotsIcon, TimerIcon } from "@/themes/catppuccin/icons";
import { BurndownChart } from "./BurndownChart";
import { effectiveUnit } from "./burndown";
import { daysLeftLabel, formatCycleRange } from "./cycle-format";
import { usePanelPrefs } from "./panel-prefs";
import { CompletedBar } from "./ProgressPanel";
import type { CycleDetailData } from "./types";

export type ActiveCycleSummaryProps = { projectId: string; data: CycleDetailData };

const GROUPS: readonly Exclude<StateGroup, "triage">[] = ["backlog", "unstarted", "started", "completed", "cancelled"];

export function ActiveCycleSummary({ projectId, data }: ActiveCycleSummaryProps) {
  const { cycle, pointsProgress, today } = data;
  const prefs = usePanelPrefs();
  const unit = effectiveUnit(prefs.unit, pointsProgress !== null);
  const progress = unit === "points" && pointsProgress ? pointsProgress : cycle.progress;
  return (
    <Card className="tessera-planning-summary">
      <VStack gap={4}>
        <HStack gap={3} vAlign="center" wrap="wrap">
          <Heading level={3}>{cycle.name}</Heading>
          <Token label="Current" color="blue" size="sm" />
        </HStack>
        <HStack gap={4} vAlign="center" wrap="wrap">
          <HStack gap={1.5} vAlign="center">
            <Icon icon={CalendarDotsIcon} size="sm" color="secondary" />
            <Text type="supporting">{formatCycleRange(cycle.start_date, cycle.end_date, today)}</Text>
          </HStack>
          {cycle.end_date ? (
            <HStack gap={1.5} vAlign="center">
              <Icon icon={TimerIcon} size="sm" color="secondary" />
              <Text type="supporting">{daysLeftLabel(cycle.end_date, today)}</Text>
            </HStack>
          ) : null}
        </HStack>
        <CompletedBar counts={cycle.progress} />
        <HStack gap={4} wrap="wrap" vAlign="center">
          {GROUPS.map((group) => (
            <HStack key={group} gap={1.5} vAlign="center">
              <StatusDot variant={stateGroupVariant(group)} label={stateGroupLabel(group)} />
              <Text type="supporting">
                {stateGroupLabel(group)} {cycle.progress[group]}
              </Text>
            </HStack>
          ))}
        </HStack>
        <BurndownChart cycle={cycle} progress={progress} kind={prefs.chart} today={today} height={160} hasDataTable={false} />
        <Link href={`/projects/${projectId}/cycles/${cycle.id}`} isStandalone className="tessera-planning-link">
          Open cycle
        </Link>
      </VStack>
    </Card>
  );
}
