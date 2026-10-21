"use client";

/**
 * Automations tab of the project settings (docs/drafts/p10-plan.md "Automations tab"):
 * Auto-archive closed work items, auto-close inactive work items, status and manual run.
 */
import { useEffect, useState, useTransition } from "react";
import { notFound } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { Token } from "@astryxdesign/core/Token";
import { useToast } from "@astryxdesign/core/Toast";
import {
  getAutomationStatusAction,
  runAutomationsAction,
  updateAutomationSettingsAction,
} from "@/app/actions/automations";
import { failureText } from "@/components/planning/archive-rules";
import { useOptionalProject } from "@/components/work-items/project-provider";
import type { AutomationStatus } from "@/lib/tessera/types";

const MONTH_OPTIONS = [
  { value: "1", label: "1 month" },
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
  { value: "9", label: "9 months" },
  { value: "12", label: "12 months" },
];

/** Toast text when `run_automations` reports `lease_held` (decision 28). */
export const LEASE_HELD_TEXT = "Automations are running in another process. Try again shortly.";

export function AutomationsSettings() {
  const context = useOptionalProject();
  if (!context) notFound();
  const { bundle } = context;
  const { project, states } = bundle;
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [isRunning, startRunTransition] = useTransition();
  const [status, setStatus] = useState<AutomationStatus | null>(null);

  const isArchived = project.archived_at !== null;
  const closeableStates = states.filter((s) => s.state_group === "cancelled" || s.state_group === "completed");
  const defaultCloseState =
    states.find((s) => s.state_group === "cancelled")?.id ??
    states.find((s) => s.state_group === "completed")?.id ??
    states[0]?.id;

  const refreshStatus = () => {
    startTransition(async () => {
      const res = await getAutomationStatusAction({});
      if (res.ok) setStatus(res.data);
    });
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  const archiveEnabled = project.archive_in_months !== null;
  const closeEnabled = project.close_in_months !== null;

  const toggleArchive = async (enabled: boolean) => {
    const res = await updateAutomationSettingsAction({
      project_id: project.id,
      archive_in_months: enabled ? 6 : null,
    });
    if (!res.ok) toast({ type: "error", body: failureText("Could not update archive setting", res.message) });
    else refreshStatus();
  };

  const changeArchiveMonths = (months: string) => {
    startTransition(async () => {
      const res = await updateAutomationSettingsAction({
        project_id: project.id,
        archive_in_months: Number(months),
      });
      if (!res.ok) toast({ type: "error", body: failureText("Could not update archive months", res.message) });
      else refreshStatus();
    });
  };

  const toggleClose = async (enabled: boolean) => {
    const res = await updateAutomationSettingsAction({
      project_id: project.id,
      close_in_months: enabled ? 3 : null,
      close_state_id: enabled ? (project.close_state_id ?? defaultCloseState) : null,
    });
    if (!res.ok) toast({ type: "error", body: failureText("Could not update close setting", res.message) });
    else refreshStatus();
  };

  const changeCloseMonths = (months: string) => {
    startTransition(async () => {
      const res = await updateAutomationSettingsAction({
        project_id: project.id,
        close_in_months: Number(months),
      });
      if (!res.ok) toast({ type: "error", body: failureText("Could not update close months", res.message) });
      else refreshStatus();
    });
  };

  const changeCloseState = (stateId: string) => {
    startTransition(async () => {
      const res = await updateAutomationSettingsAction({
        project_id: project.id,
        close_state_id: stateId,
      });
      if (!res.ok) toast({ type: "error", body: failureText("Could not update close state", res.message) });
      else refreshStatus();
    });
  };

  const runNow = () => {
    startRunTransition(async () => {
      const res = await runAutomationsAction({ project_id: project.id });
      if (!res.ok) {
        toast({ type: "error", body: failureText("Could not run automations", res.message) });
        return;
      }
      // Another process holds the lease (decision 28): this call wrote nothing, so there is no summary
      // to report and Due now / Last run stay as they are.
      if (res.data.lease_held) {
        toast({ type: "info", body: LEASE_HELD_TEXT });
        return;
      }
      const pSummary = res.data.projects.find((p) => p.project_id === project.id);
      const closed = pSummary?.closed ?? 0;
      const archived = pSummary?.archived ?? 0;
      toast({
        type: "info",
        body: `Automations completed: ${closed} closed, ${archived} archived.`,
      });
      refreshStatus();
    });
  };

  const projectStatus = status?.projects.find((p) => p.project_id === project.id);
  const dueTotal = (projectStatus?.due_close ?? 0) + (projectStatus?.due_archive ?? 0);

  return (
    <VStack gap={6}>
      <Card padding={4}>
        <VStack gap={4}>
          <HStack justify="between" vAlign="center">
            <VStack gap={1}>
              <Heading level={3}>Auto-archive closed work items</Heading>
              <Text color="secondary">Automatically archive items that have been in a closed state.</Text>
            </VStack>
            <Switch
              label="Auto-archive closed work items"
              isLabelHidden
              size="sm"
              value={archiveEnabled}
              changeAction={toggleArchive}
              isDisabled={isArchived || isPending}
            />
          </HStack>
          {archiveEnabled ? (
            <Selector
              label="Archive after"
              options={MONTH_OPTIONS}
              value={String(project.archive_in_months ?? 6)}
              onChange={changeArchiveMonths}
              isDisabled={isArchived || isPending}
            />
          ) : null}
        </VStack>
      </Card>

      <Card padding={4}>
        <VStack gap={4}>
          <HStack justify="between" vAlign="center">
            <VStack gap={1}>
              <Heading level={3}>Auto-close inactive work items</Heading>
              <Text color="secondary">Automatically move inactive items to a closed or cancelled state.</Text>
            </VStack>
            <Switch
              label="Auto-close inactive work items"
              isLabelHidden
              size="sm"
              value={closeEnabled}
              changeAction={toggleClose}
              isDisabled={isArchived || isPending}
            />
          </HStack>
          {closeEnabled ? (
            <HStack gap={4} wrap="wrap">
              <Selector
                label="Close after"
                options={MONTH_OPTIONS}
                value={String(project.close_in_months ?? 3)}
                onChange={changeCloseMonths}
                isDisabled={isArchived || isPending}
              />
              <Selector
                label="Close to state"
                options={closeableStates.map((s) => ({ value: s.id, label: s.name }))}
                value={project.close_state_id ?? defaultCloseState}
                onChange={changeCloseState}
                isDisabled={isArchived || isPending}
              />
            </HStack>
          ) : null}
        </VStack>
      </Card>

      <Card padding={4}>
        <VStack gap={4}>
          <Heading level={3}>Automation status</Heading>
          <HStack gap={4} vAlign="center" wrap="wrap">
            <HStack gap={2} vAlign="center">
              <Text color="secondary">Last run:</Text>
              {status?.last_run_at ? (
                <Timestamp value={status.last_run_at} />
              ) : (
                <Text color="secondary">Never</Text>
              )}
            </HStack>
            <HStack gap={2} vAlign="center">
              <Text color="secondary">Due now:</Text>
              <Token
                label={dueTotal > 0 ? `${dueTotal} items due` : "0 items due"}
                color={dueTotal > 0 ? "yellow" : "gray"}
              />
            </HStack>
            {projectStatus ? (
              <HStack gap={2} vAlign="center">
                <Token label={`${projectStatus.due_close} to close`} size="sm" />
                <Token label={`${projectStatus.due_archive} to archive`} size="sm" />
              </HStack>
            ) : null}
          </HStack>
          <HStack gap={2}>
            <Button
              variant="primary"
              size="sm"
              label="Run now"
              className="tessera-settings-action"
              isLoading={isRunning}
              isDisabled={isArchived || isRunning}
              onClick={runNow}
            />
            <Button
              variant="ghost"
              size="sm"
              label="Refresh status"
              className="tessera-settings-action"
              isLoading={isPending}
              onClick={refreshStatus}
            />
          </HStack>
        </VStack>
      </Card>
    </VStack>
  );
}
