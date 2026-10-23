"use client";

/**
 * Assignees, Labels and States breakdown of a cycle's or module's progress
 * (docs/contracts/ui.md "Shared planning pieces"). The tabs swap a panel in
 * place, so the strip speaks the WAI-ARIA tabs pattern (`role="tablist"`,
 * arrow keys move between the tabs) and each panel is a `role="tabpanel"`
 * labelled by its tab. Ids come from `useId()`, so two panels on one page
 * never collide. Names come from the project bundle; an actor, label or state
 * the bundle no longer holds reads "Removed".
 */
import { useId, useState, type ReactNode } from "react";
import { Avatar } from "@astryxdesign/core/Avatar";
import { List, ListItem } from "@astryxdesign/core/List";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { useProject } from "@/components/work-items/project-provider";
import { paletteTokenColor, stateGroupLabel, stateGroupVariant } from "@/components/work-items/properties";
import type { ProgressBreakdownRow } from "@/lib/tessera/types";

export type BreakdownTabsProps = {
  /** Item count per state id. */
  byState: Record<string, number>;
  /** Rows with completed counts; absent on snapshots frozen before P3. */
  assignees?: ProgressBreakdownRow[];
  labels?: ProgressBreakdownRow[];
  /** Fallback rows (totals only) when `assignees` / `labels` are absent. */
  byAssignee: Record<string, number>;
  byLabel: Record<string, number>;
};

type TabKey = "assignees" | "labels" | "states";

const TABS: readonly { key: TabKey; label: string }[] = [
  { key: "assignees", label: "Assignees" },
  { key: "labels", label: "Labels" },
  { key: "states", label: "States" },
];

const REMOVED = "Removed";

function isTabKey(value: string): value is TabKey {
  return TABS.some((tab) => tab.key === value);
}

/** Rows from the breakdown when present, else totals-only rows from the count map (engine order kept). */
function rowsOf(rows: ProgressBreakdownRow[] | undefined, counts: Record<string, number>): { id: string | null; total: number; completed: number | null }[] {
  if (rows) return rows;
  return Object.entries(counts).map(([id, total]) => ({ id, total, completed: null }));
}

function RowCount({ name, total, completed }: { name: string; total: number; completed: number | null }) {
  if (completed === null) {
    return (
      <Text type="supporting" hasTabularNumbers>
        {total}
      </Text>
    );
  }
  return (
    <HStack gap={2} vAlign="center">
      <ProgressBar className="tessera-planning-row-bar" isLabelHidden label={`${name} completed`} variant="success" value={completed} max={Math.max(total, 1)} />
      <Text type="supporting" hasTabularNumbers>
        {completed}/{total}
      </Text>
    </HStack>
  );
}

function EmptyRows({ text }: { text: string }) {
  return (
    <Text type="supporting" color="secondary">
      {text}
    </Text>
  );
}

export function BreakdownTabs({ byState, assignees, labels, byAssignee, byLabel }: BreakdownTabsProps) {
  const base = useId();
  const [active, setActive] = useState<TabKey>("assignees");
  const { bundle, actorsById, labelsById } = useProject();

  const assigneeRows = rowsOf(assignees, byAssignee);
  const labelRows = rowsOf(labels, byLabel);
  // States follow the bundle's order; ids the bundle no longer holds come last.
  const knownStates = bundle.states.filter((state) => (byState[state.id] ?? 0) > 0);
  const knownIds = new Set(knownStates.map((state) => state.id));
  const unknownStates = Object.entries(byState).filter(([id, count]) => !knownIds.has(id) && count > 0);

  const panels: Record<TabKey, ReactNode> = {
    assignees:
      assigneeRows.length === 0 ? (
        <EmptyRows text="No work items" />
      ) : (
        <List density="compact" className="tessera-planning-panel-list">
          {assigneeRows.map((row) => {
            const name = row.id === null ? "No assignee" : (actorsById.get(row.id)?.name ?? REMOVED);
            return (
              <ListItem
                key={row.id ?? "none"}
                startContent={<Avatar name={name} size="sm" tooltip={false} />}
                label={name}
                endContent={<RowCount name={name} total={row.total} completed={row.completed} />}
              />
            );
          })}
        </List>
      ),
    labels:
      labelRows.length === 0 ? (
        <EmptyRows text="No work items" />
      ) : (
        <List density="compact" className="tessera-planning-panel-list">
          {labelRows.map((row) => {
            const label = row.id === null ? undefined : labelsById.get(row.id);
            const name = row.id === null ? "No label" : (label?.name ?? REMOVED);
            return (
              <ListItem
                key={row.id ?? "none"}
                label={row.id === null || !label ? name : <Token label={name} color={paletteTokenColor(label.color)} size="sm" />}
                endContent={<RowCount name={name} total={row.total} completed={row.completed} />}
              />
            );
          })}
        </List>
      ),
    states:
      knownStates.length + unknownStates.length === 0 ? (
        <EmptyRows text="No work items" />
      ) : (
        <List density="compact" className="tessera-planning-panel-list">
          {knownStates.map((state) => (
            <ListItem
              key={state.id}
              startContent={<StatusDot variant={stateGroupVariant(state.state_group)} label={stateGroupLabel(state.state_group)} />}
              label={state.name}
              endContent={
                <Text type="supporting" hasTabularNumbers>
                  {byState[state.id]}
                </Text>
              }
            />
          ))}
          {unknownStates.map(([id, count]) => (
            <ListItem
              key={id}
              label={REMOVED}
              endContent={
                <Text type="supporting" hasTabularNumbers>
                  {count}
                </Text>
              }
            />
          ))}
        </List>
      ),
  };

  return (
    <VStack gap={2}>
      <TabList role="tablist" aria-label="Breakdown" value={active} onChange={(value) => isTabKey(value) && setActive(value)} size="sm" layout="hug" className="tessera-planning-breakdown-tabs">
        {TABS.map((tab) => (
          <Tab key={tab.key} value={tab.key} label={tab.label} id={`${base}-tab-${tab.key}`} panelId={`${base}-panel-${tab.key}`} />
        ))}
      </TabList>
      {TABS.map((tab) => (
        <VStack
          key={tab.key}
          id={`${base}-panel-${tab.key}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${tab.key}`}
          hidden={tab.key !== active}
          tabIndex={0}
          className="tessera-planning-tabpanel"
        >
          {panels[tab.key]}
        </VStack>
      ))}
    </VStack>
  );
}
