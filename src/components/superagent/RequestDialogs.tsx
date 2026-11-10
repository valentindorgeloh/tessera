"use client";

/**
 * The three dialogs of a request's actions (decision 152; docs/contracts/ui.md
 * "Superagent control"): Stop asks first because it is final, Resize picks S, M
 * or L, Budget sets the USD limit. The screen mounts one while it is open, so
 * each gives focus back to the row's menu when it unmounts. A failed call keeps
 * the dialog open with its Toast; a done one closes it.
 */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { superagentBudgetAction, superagentRequestAction, superagentResizeAction } from "@/app/actions/superagent";
import { AlertDialog, Dialog, DialogHeader } from "@/components/shell/dialogs";
import type { RequestSize, RequestSummary } from "@/lib/superagent/types";
import { actionFailureText, actionVerb, formatUsd, type FailureContext } from "./superagent-format";
import { useRunnerReport } from "./use-runner-report";

export type RequestDialog = { kind: "stop" | "resize" | "budget"; request: RequestSummary };

type Props = { dialog: RequestDialog | null; context: FailureContext; onClose: () => void };

const SIZES: readonly RequestSize[] = ["S", "M", "L"];
const MIN_BUDGET_USD = 0.01;
const MAX_BUDGET_USD = 10000;

export function RequestDialogs({ dialog, context, onClose }: Props) {
  if (dialog === null) return null;
  const { kind, request } = dialog;
  // Keyed by request, so another request's dialog never starts from this one's draft.
  if (kind === "stop") return <StopDialog key={request.id} request={request} context={context} onClose={onClose} />;
  if (kind === "resize") return <ResizeDialog key={request.id} request={request} context={context} onClose={onClose} />;
  return <BudgetDialog key={request.id} request={request} context={context} onClose={onClose} />;
}

type OneProps = { request: RequestSummary; context: FailureContext; onClose: () => void };

function StopDialog({ request, context, onClose }: OneProps) {
  const [isPending, startTransition] = useTransition();
  const report = useRunnerReport(context);
  const stop = () => {
    startTransition(async () => {
      const result = await superagentRequestAction({ request_id: request.id, action: "stop" });
      if (report(result, actionFailureText("stop", request.itemKey), `${actionVerb("stop")} sent for ${request.itemKey}`)) onClose();
    });
  };
  return (
    <AlertDialog
      isOpen
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
      title={`Stop ${request.itemKey}?`}
      description="Stop is final: the session is aborted and late results are discarded."
      actionLabel="Stop request"
      onAction={stop}
      isActionLoading={isPending}
    />
  );
}

function ResizeDialog({ request, context, onClose }: OneProps) {
  const [size, setSize] = useState<RequestSize>(request.size);
  const [isPending, startTransition] = useTransition();
  const report = useRunnerReport(context);
  const title = `Resize ${request.itemKey}`;
  const resize = () => {
    startTransition(async () => {
      const result = await superagentResizeAction({ request_id: request.id, size });
      if (report(result, actionFailureText("resize", request.itemKey), `${actionVerb("resize")} sent for ${request.itemKey}`)) onClose();
    });
  };
  return (
    <Dialog
      isOpen
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
      purpose="form"
      aria-label={title}
    >
      <Layout
        header={<DialogHeader title={title} onOpenChange={() => !isPending && onClose()} hasDivider />}
        content={
          <LayoutContent>
            <VStack gap={3}>
              <Text color="secondary">{`Pick the size ${request.itemKey} should run as. It is ${request.size} now.`}</Text>
              <SegmentedControl label="Size" value={size} onChange={(value) => setSize(SIZES.find((entry) => entry === value) ?? size)}>
                {SIZES.map((entry) => (
                  <SegmentedControlItem key={entry} value={entry} label={entry} />
                ))}
              </SegmentedControl>
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={3} hAlign="end">
              <Button variant="ghost" label="Cancel" onClick={onClose} isDisabled={isPending} />
              <Button variant="primary" label="Resize" onClick={resize} isLoading={isPending} isDisabled={size === request.size} />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

function BudgetDialog({ request, context, onClose }: OneProps) {
  const [usd, setUsd] = useState<number>(request.budgetUsd);
  const [isPending, startTransition] = useTransition();
  const report = useRunnerReport(context);
  const title = `Budget for ${request.itemKey}`;
  const canSave = usd >= MIN_BUDGET_USD && usd <= MAX_BUDGET_USD && usd !== request.budgetUsd;
  const save = () => {
    startTransition(async () => {
      const result = await superagentBudgetAction({ request_id: request.id, usd });
      if (report(result, actionFailureText("budget", request.itemKey), `${actionVerb("budget")} sent for ${request.itemKey}`)) onClose();
    });
  };
  return (
    <Dialog
      isOpen
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
      purpose="form"
      aria-label={title}
    >
      <Layout
        header={<DialogHeader title={title} onOpenChange={() => !isPending && onClose()} hasDivider />}
        content={
          <LayoutContent>
            <NumberInput
              label="Budget (USD)"
              description={`Spent so far: ${formatUsd(request.costUsd)}.`}
              value={usd}
              min={MIN_BUDGET_USD}
              max={MAX_BUDGET_USD}
              step={0.5}
              hasAutoFocus
              onChange={setUsd}
            />
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={3} hAlign="end">
              <Button variant="ghost" label="Cancel" onClick={onClose} isDisabled={isPending} />
              <Button variant="primary" label="Set budget" onClick={save} isLoading={isPending} isDisabled={!canSave} />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
