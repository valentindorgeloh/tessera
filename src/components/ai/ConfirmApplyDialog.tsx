"use client";

/**
 * Confirm before Apply of a destructive proposal (docs/drafts/p5-plan.md §6,
 * decision 33). Cancel leaves the rows pending. The dialog does not close
 * itself: the caller closes it when the action settles.
 */
import { AlertDialog } from "@/components/shell/dialogs";
import type { ProposalView } from "@/lib/tessera/types";

export function ConfirmApplyDialog({
  proposals,
  isOpen,
  isActionLoading,
  onOpenChange,
  onAction,
}: {
  proposals: readonly ProposalView[];
  isOpen: boolean;
  isActionLoading: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onAction: () => void;
}) {
  const count = proposals.length;
  const titles = proposals.map((proposal) => proposal.preview.title || proposal.title);
  return (
    <AlertDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={`Apply ${count} changes?`}
      description={titles.length > 0 ? titles.join(", ") : "These changes cannot be undone from the assistant."}
      actionLabel="Apply"
      actionVariant="destructive"
      isActionLoading={isActionLoading}
      onAction={onAction}
    />
  );
}
