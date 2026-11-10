"use client";

/**
 * The runner's two overview sections (decision 151; docs/contracts/ui.md
 * "Superagent control", items 2 and 4): Health (status, checks, counts, the
 * spend bar with Pause or Resume) and Routing (the runner's statistics). The
 * screen places them apart, so this file exports each on its own.
 */
import { useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Table, pixel, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { superagentPauseAction } from "@/app/actions/superagent";
import type { RunnerState, RunnerStats, TriageRow } from "@/lib/superagent/types";
import {
  HEALTH_LABEL,
  escalationsLabel,
  formatUsd,
  healthVariant,
  intakeSummary,
  reviewRateLabel,
  spendVariant,
  triageSummary,
  usdOf,
  type FailureContext,
} from "./superagent-format";
import { useRunnerReport } from "./use-runner-report";

function Note({ children }: { children: string | null }) {
  return (
    <Text type="supporting" color="secondary">
      {children}
    </Text>
  );
}

export type RunnerHealthProps = {
  /** The runner's state, or null while it is not available (`note` says why). */
  state: RunnerState | null;
  note: string | null;
  /** The triage rows for the Triage line; null when they did not load (`triageNote` is shown instead). */
  triage: TriageRow[] | null;
  triageNote: string | null;
  context: FailureContext;
};

export function RunnerHealth({ state, note, triage, triageNote, context }: RunnerHealthProps) {
  const [isPending, startTransition] = useTransition();
  const report = useRunnerReport(context);
  const toggle = (paused: boolean) => {
    startTransition(async () => {
      const result = await superagentPauseAction({ paused });
      report(result, paused ? "Could not pause the runner" : "Could not resume the runner", paused ? "Runner paused" : "Runner resumed");
    });
  };
  return (
    <VStack gap={4} className="tessera-superagent-section">
      <Heading level={2}>
        Health
      </Heading>
      {state === null ? <Note>{note}</Note> : <HealthBody state={state} triage={triage} triageNote={triageNote} isPending={isPending} onToggle={toggle} />}
    </VStack>
  );
}

type HealthBodyProps = { state: RunnerState; triage: TriageRow[] | null; triageNote: string | null; isPending: boolean; onToggle: (paused: boolean) => void };

function HealthBody({ state, triage, triageNote, isPending, onToggle }: HealthBodyProps) {
  const { health, spend, slots, counts, intake } = state;
  // A cap of 0 leaves no scale: the bar then spans what was spent (or 1), so it never divides by zero.
  const max = spend.dailyCapUsd > 0 ? spend.dailyCapUsd : Math.max(spend.todayUsd, 1);
  return (
    <VStack gap={4}>
      <HStack gap={2} vAlign="center">
        <StatusDot variant={healthVariant(health.status)} label={HEALTH_LABEL[health.status]} />
        <Text weight="medium">{HEALTH_LABEL[health.status]}</Text>
      </HStack>
      {health.checks.length === 0 ? null : (
        <List density="compact" aria-label="Health checks">
          {health.checks.map((check) => (
            <ListItem
              key={check.name}
              label={check.name}
              description={
                check.detail === null ? undefined : (
                  <Text type="supporting" color="secondary">
                    {check.detail}
                  </Text>
                )
              }
              startContent={<StatusDot variant={check.ok ? "success" : "error"} label={check.ok ? "Passed" : "Failed"} />}
            />
          ))}
        </List>
      )}
      <MetadataList>
        <MetadataListItem label="Slots">{`${slots.running} of ${slots.max} running`}</MetadataListItem>
        <MetadataListItem label="Needs you">{String(counts.needsYou)}</MetadataListItem>
        <MetadataListItem label="Working">{String(counts.working)}</MetadataListItem>
        <MetadataListItem label="Queued">{String(counts.queued)}</MetadataListItem>
        <MetadataListItem label="Triage">{triage === null ? (triageNote ?? "Not available") : triageSummary(triage)}</MetadataListItem>
        <MetadataListItem label="Intake">{intakeSummary(intake)}</MetadataListItem>
      </MetadataList>
      <HStack gap={4} vAlign="end" wrap="wrap">
        <VStack className="tessera-superagent-spend">
          <ProgressBar
            label="Spent today"
            value={Math.min(spend.todayUsd, max)}
            max={max}
            hasValueLabel
            formatValueLabel={() => usdOf(spend.todayUsd, spend.dailyCapUsd)}
            variant={spendVariant(spend.todayUsd, spend.dailyCapUsd)}
          />
        </VStack>
        <Button variant="secondary" size="sm" label={state.paused ? "Resume" : "Pause"} isLoading={isPending} onClick={() => onToggle(!state.paused)} />
      </HStack>
    </VStack>
  );
}

type SizeRow = RunnerStats["bySize"][number];
type ModelRow = RunnerStats["byModel"][number];

const FIRST_COLUMN = proportional(1, { minWidth: 96 });
const NUMBER_COLUMN = pixel(112);

const SIZE_COLUMNS: TableColumn<SizeRow>[] = [
  { key: "size", header: "Size", width: FIRST_COLUMN, renderCell: (row) => <Text>{row.size}</Text> },
  { key: "completed", header: "Completed", width: NUMBER_COLUMN, align: "end", renderCell: (row) => <Text hasTabularNumbers>{row.completed}</Text> },
  { key: "avg", header: "Average cost", width: NUMBER_COLUMN, align: "end", renderCell: (row) => <Text hasTabularNumbers>{formatUsd(row.avgCostUsd)}</Text> },
];

const MODEL_COLUMNS: TableColumn<ModelRow>[] = [
  { key: "model", header: "Model", width: FIRST_COLUMN, renderCell: (row) => <Text>{row.model}</Text> },
  { key: "sessions", header: "Sessions", width: NUMBER_COLUMN, align: "end", renderCell: (row) => <Text hasTabularNumbers>{row.sessions}</Text> },
  { key: "cost", header: "Cost", width: NUMBER_COLUMN, align: "end", renderCell: (row) => <Text hasTabularNumbers>{formatUsd(row.costUsd)}</Text> },
];

export type RunnerRoutingProps = {
  /** The runner's statistics, or null while they are not available (`note` says why). */
  stats: RunnerStats | null;
  note: string | null;
};

export function RunnerRouting({ stats, note }: RunnerRoutingProps) {
  return (
    <VStack gap={4} className="tessera-superagent-section">
      <Heading level={2}>
        Routing
      </Heading>
      {stats === null ? (
        <Note>{note}</Note>
      ) : (
        <VStack gap={4}>
          <HStack gap={4} vAlign="start" wrap="wrap">
            <VStack gap={2} className="tessera-superagent-half">
              <Heading level={3}>
                By size
              </Heading>
              {stats.bySize.length === 0 ? (
                <Note>No completed requests yet.</Note>
              ) : (
                <Table<SizeRow> aria-label="By size" density="compact" idKey="size" data={stats.bySize} columns={SIZE_COLUMNS} />
              )}
            </VStack>
            <VStack gap={2} className="tessera-superagent-half">
              <Heading level={3}>
                By model
              </Heading>
              {stats.byModel.length === 0 ? (
                <Note>No sessions yet.</Note>
              ) : (
                <Table<ModelRow> aria-label="By model" density="compact" idKey="model" data={stats.byModel} columns={MODEL_COLUMNS} />
              )}
            </VStack>
          </HStack>
          <MetadataList>
            <MetadataListItem label="Size changed">{`${stats.sizeChanged.changed} of ${stats.sizeChanged.total} requests`}</MetadataListItem>
            <MetadataListItem label="First-pass reviews">{reviewRateLabel(stats.firstPassReviewRate)}</MetadataListItem>
            <MetadataListItem label="Escalations">{escalationsLabel(stats.escalations)}</MetadataListItem>
          </MetadataList>
        </VStack>
      )}
    </VStack>
  );
}
