"use client";

/**
 * Progress of a cycle or module (docs/contracts/ui.md "Shared planning
 * pieces"): the completed bar ("3 of 8"), an optional points line, the five
 * state groups, the chart the caller passes (cycles only in P3), the
 * Assignees / Labels / States breakdown and the captions. Item counts drive
 * everything except the points line.
 */
import type { ReactNode } from "react";
import { Heading } from "@astryxdesign/core/Heading";
import { List, ListItem } from "@astryxdesign/core/List";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { stateGroupLabel, stateGroupVariant } from "@/components/work-items/properties";
import type { PointsCounts, ProgressBreakdownRow, ProgressCounts, StateGroup } from "@/lib/tessera/types";
import { BreakdownTabs } from "./BreakdownTabs";
import { formatAmount, formatNumber } from "./burndown";

export type ProgressPanelProps = {
  /** "Progress". */
  title: string;
  /** Items: drives the top bar and the five state-group rows. */
  counts: ProgressCounts;
  /** Second line "12 of 20 points" when present. */
  points?: PointsCounts;
  /** States tab: one row per state id, count only. */
  byState: Record<string, number>;
  /** Absent on snapshots frozen before P3. */
  assignees?: ProgressBreakdownRow[];
  labels?: ProgressBreakdownRow[];
  /** Fallback rows (totals only) when assignees is absent. */
  byAssignee: Record<string, number>;
  byLabel: Record<string, number>;
  /** Cycles: true → caption "Includes archived work items." */
  includesArchived?: boolean;
  /** Cycles: cycle.progress_snapshot !== null → caption "Frozen when the open items moved or the cycle was archived." */
  isFrozen?: boolean;
  /** Cycles pass <BurndownChart/>; modules pass nothing (chart in P9). */
  chart?: ReactNode;
};

const GROUPS: readonly Exclude<StateGroup, "triage">[] = ["backlog", "unstarted", "started", "completed", "cancelled"];

/** "3 of 8" for the bar's value label. */
export function formatOfTotal(value: number, max: number): string {
  return `${formatNumber(value)} of ${formatNumber(max)}`;
}

/** The completed bar shared with the cycle summary card; "No work items" when nothing counts. */
export function CompletedBar({ counts }: { counts: ProgressCounts }) {
  const max = counts.total - counts.cancelled;
  if (max <= 0) return <Text type="supporting">No work items</Text>;
  return <ProgressBar label="Completed" value={counts.completed} max={max} variant="success" hasValueLabel formatValueLabel={formatOfTotal} />;
}

/** One row per state group with its count. */
export function StateGroupRows({ counts }: { counts: ProgressCounts }) {
  return (
    <List density="compact">
      {GROUPS.map((group) => (
        <ListItem
          key={group}
          startContent={<StatusDot variant={stateGroupVariant(group)} label={stateGroupLabel(group)} />}
          label={stateGroupLabel(group)}
          endContent={
            <Text type="supporting" hasTabularNumbers>
              {counts[group]}
            </Text>
          }
        />
      ))}
    </List>
  );
}

export function ProgressPanel({ title, counts, points, byState, assignees, labels, byAssignee, byLabel, includesArchived = false, isFrozen = false, chart }: ProgressPanelProps) {
  const pointsScope = points ? points.total - points.cancelled : 0;
  return (
    <VStack gap={4} className="tessera-planning-progress">
      <Heading level={3}>{title}</Heading>
      <VStack gap={2}>
        <CompletedBar counts={counts} />
        {points ? <Text type="supporting">{`${formatNumber(points.completed)} of ${formatAmount(pointsScope, "points")}`}</Text> : null}
      </VStack>
      <StateGroupRows counts={counts} />
      {chart}
      <BreakdownTabs byState={byState} assignees={assignees} labels={labels} byAssignee={byAssignee} byLabel={byLabel} />
      {includesArchived || isFrozen ? (
        <VStack gap={1}>
          {includesArchived ? <Text type="supporting">Includes archived work items.</Text> : null}
          {isFrozen ? <Text type="supporting">Frozen when the open items moved or the cycle was archived.</Text> : null}
        </VStack>
      ) : null}
    </VStack>
  );
}
