"use client";

/**
 * Action bar for one intake item, above the embedded work item. Accept,
 * decline, snooze, duplicate and delete go through the intake actions.
 * An accepted item only offers a link into the project.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { useToast } from "@astryxdesign/core/Toast";
import {
  acceptIntakeItemAction,
  declineIntakeItemAction,
  deleteIntakeItemAction,
  markIntakeDuplicateAction,
  snoozeIntakeItemAction,
  unsnoozeIntakeItemAction,
} from "@/app/actions/intake";
import { WorkItemDetail, type WorkItemDetailData } from "@/components/detail";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { SnoozeDialog } from "@/components/inbox/SnoozeDialog";
import { AlertDialog } from "@/components/shell/dialogs";
import { failureText } from "@/components/planning/archive-rules";
import { useProject } from "@/components/work-items/project-provider";
import type { IntakeItemView } from "@/lib/tessera/types";
import { AcceptIcon, DeclineIcon, DuplicateIcon, TrashIcon } from "@/themes/catppuccin/icons";
import { DuplicateDialog } from "./DuplicateDialog";
import { intakeHref, sourceLabel, statusToken, type IntakeQuery } from "./intake-format";

export type IntakeDetailProps = {
  view: IntakeItemView;
  detail: WorkItemDetailData;
  query: IntakeQuery;
  nextItemId: string | null;
};

export function IntakeDetail({ view, detail, query, nextItemId }: IntakeDetailProps) {
  const router = useRouter();
  const toast = useToast();
  const { bundle } = useProject();
  const [isPending, startTransition] = useTransition();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [snoozeAt, setSnoozeAt] = useState<Date | null>(null);
  const archived = bundle.project.archived_at !== null;
  const accepted = view.status === "accepted";
  const token = statusToken(view);
  const stateName = bundle.states.find((state) => state.is_default && state.state_group !== "triage")?.name ?? "the project";

  const go = (item: string | null) => router.push(intakeHref(bundle.project.id, query.tab, query.q, item));

  const run = (call: () => Promise<{ ok: true } | { ok: false; message: string }>, prefix: string, after?: () => void) => {
    startTransition(async () => {
      const result = await call();
      if (!result.ok) toast({ type: "error", body: failureText(prefix, result.message) });
      else after?.();
    });
  };

  const accept = () => {
    run(
      () => acceptIntakeItemAction({ intake_item_id: view.id }),
      "Could not accept",
      () => {
        toast({
          type: "info",
          body: `Accepted ${view.key} into ${stateName}`,
          endContent: <Button variant="ghost" size="sm" label="Open" href={`/projects/${bundle.project.id}/work-items/${view.work_item_id}`} />,
        });
        go(nextItemId);
      },
    );
  };

  return (
    <VStack gap={0} className="tessera-intake-detail">
      <VStack gap={3} padding={4}>
        <Banner
          status="info"
          title={token ?? "In Intake"}
          description={
            <>
              Submitted by {view.created_by.name} via {sourceLabel(view.source)} <RelativeTime value={view.created_at} hasTooltip={false} />
            </>
          }
          endContent={
            accepted ? (
              <Button variant="primary" size="sm" label="Open in project" href={`/projects/${bundle.project.id}/work-items/${view.work_item_id}`} />
            ) : (
              <HStack gap={2} vAlign="center">
                <Button variant="primary" size="sm" label="Accept" icon={<AcceptIcon />} isDisabled={archived} isLoading={isPending} onClick={accept} />
                <Button variant="secondary" size="sm" label="Decline" icon={<DeclineIcon />} isDisabled={archived} onClick={() => setDeclineOpen(true)} />
                {view.status === "snoozed" ? (
                  <Button variant="ghost" size="sm" label="Unsnooze" isDisabled={archived} onClick={() => run(() => unsnoozeIntakeItemAction({ intake_item_id: view.id }), "Could not unsnooze")} />
                ) : (
                  <Button variant="ghost" size="sm" label="Snooze…" isDisabled={archived} onClick={() => setSnoozeAt(new Date())} />
                )}
                <Button variant="ghost" size="sm" label="Mark duplicate…" icon={<DuplicateIcon />} isDisabled={archived} onClick={() => setDuplicateOpen(true)} />
                <MoreMenu label="Intake actions" size="sm" isDisabled={archived} items={[{ id: "delete", label: "Delete", icon: TrashIcon, onClick: () => setDeleteOpen(true) }]} />
              </HStack>
            )
          }
        />
      </VStack>
      <WorkItemDetail data={detail} host="peek" onOpenItem={(id) => router.push(`/projects/${bundle.project.id}/work-items/${id}`)} />
      <AlertDialog
        isOpen={declineOpen}
        onOpenChange={setDeclineOpen}
        title="Decline this work item?"
        description="It moves to Closed. You can still accept it later."
        actionLabel="Decline"
        onAction={() => {
          setDeclineOpen(false);
          run(() => declineIntakeItemAction({ intake_item_id: view.id }), "Could not decline", () => go(nextItemId));
        }}
      />
      <AlertDialog
        isOpen={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${view.key}?`}
        description="The work item and this intake item are deleted."
        actionLabel="Delete"
        actionVariant="destructive"
        onAction={() => {
          setDeleteOpen(false);
          run(() => deleteIntakeItemAction({ intake_item_id: view.id }), "Could not delete", () => go(nextItemId));
        }}
      />
      <SnoozeDialog
        isOpen={snoozeAt !== null}
        openedAt={snoozeAt}
        onOpenChange={(open) => {
          if (!open) setSnoozeAt(null);
        }}
        onConfirm={(until) => {
          setSnoozeAt(null);
          run(() => snoozeIntakeItemAction({ intake_item_id: view.id, until: until.toISOString() }), "Could not snooze", () => go(nextItemId));
        }}
      />
      <DuplicateDialog
        isOpen={duplicateOpen}
        onOpenChange={setDuplicateOpen}
        projectId={bundle.project.id}
        excludeId={view.work_item_id}
        isPending={isPending}
        onConfirm={(workItemId) => {
          setDuplicateOpen(false);
          run(() => markIntakeDuplicateAction({ intake_item_id: view.id, duplicate_of_id: workItemId }), "Could not mark as duplicate", () => go(nextItemId));
        }}
      />
    </VStack>
  );
}
