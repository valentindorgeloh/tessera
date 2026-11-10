"use client";

/**
 * The top of an open chat (decision 146; docs/contracts/ui.md "Superagent
 * chat"): the work item's key and title, then the item's newest runner request
 * with its stage, cost, pull request and action buttons. Approve, Retry and
 * Lift hold run at once and report like the control screen's table; Stop,
 * Resize and Budget open that screen's dialogs through `onDialog`.
 */
import { useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { superagentRequestAction } from "@/app/actions/superagent";
import type { RequestDialog } from "@/components/superagent/RequestDialogs";
import { PullRequestLink, StageLabel } from "@/components/superagent/request-parts";
import { ACTION_LABELS, actionFailureText, actionVerb, primaryAction, usdOf, type FailureContext } from "@/components/superagent/superagent-format";
import { useRunnerReport } from "@/components/superagent/use-runner-report";
import type { ChatOpen, RequestSummary, RunnerAction, SuperagentChatLoad } from "@/lib/superagent/types";

type Item = Extract<ChatOpen, { kind: "item" }>;

export type ConversationHeaderProps = {
  open: Item;
  load: SuperagentChatLoad;
  onDialog: (dialog: RequestDialog) => void;
};

export function ConversationHeader({ open, load, onDialog }: ConversationHeaderProps) {
  const context: FailureContext = { tokenFile: load.tokenFile, runnerUrl: load.runnerUrl };
  const [isPending, startTransition] = useTransition();
  const report = useRunnerReport(context);
  const { request } = open;

  const run = (target: RequestSummary, action: "approve" | "retry" | "lift_hold") => {
    startTransition(async () => {
      const result = await superagentRequestAction({ request_id: target.id, action });
      report(result, actionFailureText(action, target.itemKey), `${actionVerb(action)} sent for ${target.itemKey}`);
    });
  };

  const choose = (target: RequestSummary, action: RunnerAction) => {
    if (action === "approve" || action === "retry" || action === "lift_hold") run(target, action);
    else onDialog({ kind: action, request: target });
  };

  const primary = request === null ? null : primaryAction(request.actions);
  return (
    <VStack gap={2} paddingInline={4} paddingBlock={3} className="tessera-chat-header">
      <Heading level={2}>
        <Link href={`/work-items/${open.workItemId}`} className="tessera-superagent-link">
          {open.itemKey}
        </Link>{" "}
        {open.title}
      </Heading>
      {request !== null ? (
        <HStack gap={3} vAlign="center" wrap="wrap">
          <StageLabel stage={request.stage} hasReason />
          <Text hasTabularNumbers>{usdOf(request.costUsd, request.budgetUsd)}</Text>
          {/* "None" fits the control screen's PR column; a header line without a PR just leaves it out. */}
          {request.pr !== null ? <PullRequestLink pr={request.pr} /> : null}
          {request.actions.map((action) => (
            <Button
              key={action}
              variant={action === primary ? "primary" : "secondary"}
              size="sm"
              label={`${ACTION_LABELS[action]} ${open.itemKey}`}
              isDisabled={isPending}
              onClick={() => choose(request, action)}
            >
              {ACTION_LABELS[action]}
            </Button>
          ))}
        </HStack>
      ) : load.requests.ok ? (
        <Text type="supporting" color="secondary">
          No runner request yet.
        </Text>
      ) : null}
    </VStack>
  );
}
