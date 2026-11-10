"use client";

/**
 * Superagent (decision 145; docs/contracts/ui.md "Superagent control"): the
 * control screen of the runner on this Mac. A panel page with the banners, then
 * Needs you, Health, History, Routing, Settings and Team sections. The page
 * (server) loads everything in one go; while the tab is visible and none of the
 * screen's dialogs is open the screen asks Next to reload it every 15 seconds,
 * so health and stages stay current.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { IconButton } from "@astryxdesign/core/IconButton";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { superagentRefreshAction } from "@/app/actions/superagent";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import type { RequestScope, RunnerResult, SuperagentLoad } from "@/lib/superagent/types";
import { REQUEST_SCOPES, SUPERAGENT_CHAT_PATH } from "@/lib/superagent/types";
import type { AgentSettings } from "@/lib/tessera/types";
import { RetryIcon } from "@/themes/catppuccin/icons";
import { AgentSettingsSection } from "./AgentSettingsSection";
import { RequestDialogs, type RequestDialog } from "./RequestDialogs";
import { RequestHistory } from "./RequestHistory";
import { RequestsTable } from "./RequestsTable";
import { RunnerHealth, RunnerRouting } from "./RunnerOverview";
import { RunnerBanners } from "./RunnerBanners";
import { TeamSectionsSection } from "./TeamSectionsSection";
import { useRunnerRefresh } from "./use-runner-refresh";
import { sectionNote, superagentHref, teamRepos, type FailureContext, type ProjectOption } from "./superagent-format";

/** How often the screen reloads itself while it is visible (decision 145). */
export const REFRESH_INTERVAL_MS = 15_000;

const SCOPE_LABEL: Readonly<Record<RequestScope, string>> = { open: "Open", recent: "Recent", all: "All" };

export type SuperagentScreenProps = {
  runner: SuperagentLoad;
  agents: AgentSettings | null;
  projects: ProjectOption[];
  scope: RequestScope;
  requestId: string | null;
};

/** One runner load as a section sees it: its data, or null and the line to show instead (nothing is shown while the runner's state itself failed). */
function part<T>(state: RunnerResult<unknown>, own: RunnerResult<T>, context: FailureContext): { data: T | null; note: string | null } {
  const note = sectionNote(state, own, context);
  return { data: note === null && own.ok ? own.data : null, note };
}

export function SuperagentScreen({ runner, agents, projects, scope, requestId }: SuperagentScreenProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<RequestDialog | null>(null);
  const [isRefreshing, startRefresh] = useTransition();
  const context: FailureContext = { tokenFile: runner.tokenFile, runnerUrl: runner.runnerUrl };
  const isDialogOpen = dialog !== null;
  useRunnerRefresh(REFRESH_INTERVAL_MS, isDialogOpen);

  const refresh = () => {
    startRefresh(async () => {
      await superagentRefreshAction();
    });
  };

  const state = part(runner.state, runner.state, context);
  const requests = part(runner.state, runner.requests, context);
  const triage = part(runner.state, runner.triage, context);
  const stats = part(runner.state, runner.stats, context);
  const needsYou = state.data?.counts.needsYou ?? 0;

  return (
    <PanelPage
      header={
        <PanelHeader label="Superagent">
          <PanelBar
            start={<PanelTitle>Superagent</PanelTitle>}
            end={
              <>
                <Button variant="secondary" size="sm" label="Chat" href={SUPERAGENT_CHAT_PATH} />
                <IconButton label="Refresh" tooltip="Refresh" variant="ghost" size="sm" icon={<RetryIcon />} isLoading={isRefreshing} onClick={refresh} />
              </>
            }
          />
        </PanelHeader>
      }
    >
      <VStack gap={6} padding={4} className="tessera-superagent-body">
        <RunnerBanners state={runner.state} context={context} />

        <VStack gap={4} className="tessera-superagent-section">
          <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
            <HStack gap={2} vAlign="center">
              <Heading level={2}>Needs you</Heading>
              {needsYou > 0 ? <Badge label={String(needsYou)} /> : null}
            </HStack>
            <SegmentedControl
              label="Show requests"
              size="sm"
              value={scope}
              onChange={(value) => router.push(superagentHref(REQUEST_SCOPES.find((entry) => entry === value) ?? scope, requestId), { scroll: false })}
            >
              {REQUEST_SCOPES.map((entry) => (
                <SegmentedControlItem key={entry} value={entry} label={SCOPE_LABEL[entry]} />
              ))}
            </SegmentedControl>
          </HStack>
          <RequestsTable
            requests={requests.data}
            note={requests.note}
            triage={triage.data}
            triageNote={runner.state.ok ? triage.note : null}
            context={context}
            scope={scope}
            requestId={requestId}
            onOpenDialog={setDialog}
          />
        </VStack>

        <RunnerHealth state={state.data} note={state.note} triage={triage.data} triageNote={triage.note} context={context} />
        <RequestHistory requestId={requestId} detail={runner.request} note={runner.state.ok ? null : state.note} context={context} />
        <RunnerRouting stats={stats.data} note={stats.note} />
        <AgentSettingsSection agents={agents} projects={projects} runnerSettings={runner.settings} state={runner.state} context={context} />
        <TeamSectionsSection prompts={runner.prompts} repos={teamRepos(agents, runner.prompts)} state={runner.state} context={context} />
      </VStack>
      <RequestDialogs dialog={dialog} context={context} onClose={() => setDialog(null)} />
    </PanelPage>
  );
}
