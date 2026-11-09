"use client";

/**
 * Settings of the superagent screen (decisions 144 and 145; docs/contracts/ui.md
 * "Screen /agents/superagent", item 5). The section draws its own "Settings"
 * heading and two forms:
 * - "Projects and repositories": Tessera's own mapping (runner URL and a
 *   repository per project), always available; saved through
 *   `setAgentSettingsAction`.
 * - "Runner": the runner's settings, disabled with the failure text while its
 *   load failed; saved through `superagentSaveSettingsAction` with the loaded
 *   revision. The form is keyed by the revision, so a conflict (or any change
 *   by the runner) replaces the fields with the latest values.
 */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { IconButton } from "@astryxdesign/core/IconButton";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { superagentSaveSettingsAction } from "@/app/actions/superagent";
import { setAgentSettingsAction } from "@/app/actions/workspace-settings";
import { useNarrowContainer } from "@/components/workspace-settings/use-narrow-container";
import type { RunnerResult, RunnerSettings, RunnerSettingsDoc } from "@/lib/superagent/types";
import { AGENT_RUNNER_DEFAULT_URL } from "@/lib/tessera/schemas";
import type { AgentSettings } from "@/lib/tessera/types";
import { PlusIcon, TrashIcon } from "@/themes/catppuccin/icons";
import {
  droppedMappingsText,
  firstFreeProject,
  mappingErrors,
  mappingInput,
  mappingRows,
  notAvailableText,
  projectChoices,
  saveFailureToast,
  type MappingRow,
} from "./settings-format";
import { formatUsd, type ProjectOption } from "./superagent-format";

export type AgentSettingsSectionProps = {
  agents: AgentSettings | null;
  projects: ProjectOption[];
  runnerSettings: RunnerResult<RunnerSettingsDoc>;
};

/** Below this container width the paired fields stack: the mapping's project and repository, the three budgets, the cap and the parallel limit. */
const PAIR_FORM_WIDTH = 480;
/** The forms are a settings column, not a full-width sheet. */
const FORM_MAX_WIDTH = 560;
/** Per-request and daily spend limits the form accepts, in USD (the budget action's own ceiling). */
const MAX_USD = 10000;
const MIN_USD = 0.01;
const MAX_PARALLEL = 8;

export function AgentSettingsSection({ agents, projects, runnerSettings }: AgentSettingsSectionProps) {
  const { ref, isNarrow } = useNarrowContainer(PAIR_FORM_WIDTH);
  const runnerUrl = agents?.runner_url ?? AGENT_RUNNER_DEFAULT_URL;
  return (
    <VStack gap={4} ref={ref}>
      <Heading level={2}>Settings</Heading>
      {/* Keyed by what was stored and by which projects exist, so a saved mapping reloads the rows; a poll that returns the same data keeps the user's edits. */}
      <MappingForm key={JSON.stringify([agents, projects.map((project) => project.id)])} agents={agents} projects={projects} isNarrow={isNarrow} />
      <RunnerForm key={runnerSettings.ok ? `rev:${runnerSettings.data.revision}` : "unavailable"} runnerSettings={runnerSettings} runnerUrl={runnerUrl} isNarrow={isNarrow} />
    </VStack>
  );
}

type MappingFormProps = { agents: AgentSettings | null; projects: ProjectOption[]; isNarrow: boolean };

function MappingForm({ agents, projects, isNarrow }: MappingFormProps) {
  const toast = useToast();
  const [isPending, startSave] = useTransition();
  const [initial] = useState(() => mappingRows(agents, projects));
  const [url, setUrl] = useState(agents?.runner_url ?? "");
  const [rows, setRows] = useState<MappingRow[]>(initial.rows);
  const [nextKey, setNextKey] = useState(initial.rows.length);
  // Errors of an empty or unfinished field wait for the first Save; a typed value that cannot be right shows at once.
  const [showErrors, setShowErrors] = useState(false);
  const errors = mappingErrors(url, rows);
  const free = firstFreeProject(projects, rows);
  const dropped = droppedMappingsText(initial.dropped);

  const update = (key: number, patch: Partial<MappingRow>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const add = () => {
    if (free === undefined) return;
    setRows((current) => [...current, { key: nextKey, project_id: free.id, repo: "" }]);
    setNextKey(nextKey + 1);
  };
  const save = () => {
    if (errors.any) {
      setShowErrors(true);
      return;
    }
    startSave(async () => {
      const result = await setAgentSettingsAction(mappingInput(url, rows));
      if (result.ok) toast({ type: "info", body: "Mapping saved" });
      else toast({ type: "error", body: `Could not save the mapping. ${result.message}` });
    });
  };

  return (
    <VStack gap={3} maxWidth={FORM_MAX_WIDTH}>
      <Heading level={3}>Projects and repositories</Heading>
      <FormLayout>
        <TextInput
          label="Runner URL"
          description="Loopback only, so the runner's token never leaves this Mac."
          placeholder={AGENT_RUNNER_DEFAULT_URL}
          value={url}
          onChange={setUrl}
          onEnter={save}
          status={errors.url === null ? undefined : { type: "error", message: errors.url }}
        />
        {rows.length === 0 ? (
          <Text type="supporting" color="secondary">
            No project is mapped yet.
          </Text>
        ) : null}
        {rows.map((row, index) => {
          const project = projects.find((candidate) => candidate.id === row.project_id);
          const name = project?.name ?? "project";
          const repoProblem = errors.repos[index] ?? null;
          return (
            <Section key={row.key} variant="muted" padding={3}>
              <VStack gap={3}>
                <HStack gap={2} vAlign="center" hAlign="between">
                  <Text weight="medium">{name}</Text>
                  <IconButton variant="ghost" size="sm" label={`Remove ${name}`} tooltip={`Remove ${name}`} icon={<TrashIcon />} onClick={() => setRows((current) => current.filter((other) => other.key !== row.key))} />
                </HStack>
                <FormLayout direction={isNarrow ? "vertical" : "horizontal"}>
                  <Selector
                    label="Project"
                    options={projectChoices(projects, rows, row).map((choice) => ({ value: choice.id, label: choice.name }))}
                    value={row.project_id}
                    onChange={(value) => update(row.key, { project_id: value })}
                  />
                  <TextInput
                    label="Repository"
                    placeholder="name or owner/name"
                    value={row.repo}
                    onChange={(value) => update(row.key, { repo: value })}
                    onEnter={save}
                    status={repoProblem !== null && (showErrors || row.repo.trim() !== "") ? { type: "error", message: repoProblem } : undefined}
                  />
                </FormLayout>
              </VStack>
            </Section>
          );
        })}
        {dropped === null ? null : (
          <Text type="supporting" color="secondary">
            {dropped}
          </Text>
        )}
        <HStack gap={2} wrap="wrap">
          <Button
            variant="secondary"
            size="sm"
            label="Add project"
            icon={<PlusIcon />}
            isDisabled={free === undefined}
            tooltip={free === undefined ? (projects.length === 0 ? "Create a project first" : "Every project is mapped") : undefined}
            onClick={add}
          />
          <Button variant="primary" size="sm" label="Save mapping" isLoading={isPending} onClick={save} />
        </HStack>
      </FormLayout>
    </VStack>
  );
}

type RunnerFormProps = { runnerSettings: RunnerResult<RunnerSettingsDoc>; runnerUrl: string; isNarrow: boolean };

function RunnerForm({ runnerSettings, runnerUrl, isNarrow }: RunnerFormProps) {
  const toast = useToast();
  const [isPending, startSave] = useTransition();
  const doc = runnerSettings.ok ? runnerSettings.data : null;
  const [values, setValues] = useState<RunnerSettings | null>(doc?.settings ?? null);
  const isDisabled = doc === null || values === null;
  const direction = isNarrow ? "vertical" : "horizontal";

  const setBudget = (size: "S" | "M" | "L", usd: number) => setValues((current) => (current === null ? current : { ...current, budgetsUsd: { ...current.budgetsUsd, [size]: usd } }));
  const patch = (next: Partial<RunnerSettings>) => setValues((current) => (current === null ? current : { ...current, ...next }));
  const save = () => {
    if (doc === null || values === null) return;
    startSave(async () => {
      const result = await superagentSaveSettingsAction({ settings: values, base_revision: doc.revision });
      if (result.ok) {
        toast({ type: "info", body: "Runner settings saved" });
        return;
      }
      toast(saveFailureToast("Could not save the runner settings", result.failure, runnerUrl));
    });
  };
  const usd = (label: string, value: number | null, onChange: (usd: number) => void) => (
    <NumberInput label={label} value={value} onChange={onChange} min={MIN_USD} max={MAX_USD} step={0.5} formatValue={formatUsd} isDisabled={isDisabled} />
  );

  return (
    <VStack gap={3} maxWidth={FORM_MAX_WIDTH}>
      <Heading level={3}>Runner</Heading>
      {runnerSettings.ok ? null : (
        <Text type="supporting" color="secondary">
          {notAvailableText(runnerSettings.failure, runnerUrl)}
        </Text>
      )}
      <FormLayout>
        <FormLayout direction={direction}>
          {usd("Budget for S (USD)", values?.budgetsUsd.S ?? null, (value) => setBudget("S", value))}
          {usd("Budget for M (USD)", values?.budgetsUsd.M ?? null, (value) => setBudget("M", value))}
          {usd("Budget for L (USD)", values?.budgetsUsd.L ?? null, (value) => setBudget("L", value))}
        </FormLayout>
        <FormLayout direction={direction}>
          {usd("Daily cap (USD)", values?.dailyCapUsd ?? null, (value) => patch({ dailyCapUsd: value }))}
          <NumberInput
            label="Parallel requests"
            value={values?.maxParallel ?? null}
            onChange={(value) => patch({ maxParallel: value })}
            min={1}
            max={MAX_PARALLEL}
            step={1}
            isIntegerOnly
            isDisabled={isDisabled}
          />
        </FormLayout>
        <Switch label="M requests wait for my sign-off" size="sm" value={values?.signoffM ?? false} onChange={(checked) => patch({ signoffM: checked })} isDisabled={isDisabled} />
        <HStack gap={2}>
          <Button variant="primary" size="sm" label="Save runner settings" isLoading={isPending} isDisabled={isDisabled} onClick={save} />
        </HStack>
      </FormLayout>
    </VStack>
  );
}
