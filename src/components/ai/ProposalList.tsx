"use client";

/**
 * Proposals of one assistant turn (docs/drafts/p5-plan.md §6). Apply all and
 * Discard all cover the pending rows. A destructive row, or Apply all when
 * any pending row is destructive, is confirmed by the panel's dialog.
 */
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { ProposalView } from "@/lib/tessera/types";
import { ProposalIcon } from "@/themes/catppuccin/icons";
import { ProposalRow } from "./ProposalRow";

export function ProposalList({
  proposals,
  onApply,
  onDiscard,
  busyIds,
}: {
  proposals: readonly ProposalView[];
  onApply: (ids: string[]) => void;
  onDiscard: (ids: string[]) => void;
  busyIds: ReadonlySet<string>;
}) {
  if (proposals.length === 0) return null;
  const pending = proposals.filter((proposal) => proposal.status === "pending");
  const pendingIds = pending.map((proposal) => proposal.id);
  const busy = pendingIds.some((id) => busyIds.has(id));
  const countLabel = `${proposals.length} ${proposals.length === 1 ? "proposal" : "proposals"}`;
  return (
    <VStack gap={3} className="tessera-ai-proposals">
      <HStack gap={2} vAlign="center">
        <Icon icon={ProposalIcon} size="sm" />
        <Text weight="medium">{countLabel}</Text>
        <Button label="Apply all" size="sm" isDisabled={pending.length === 0 || busy} onClick={() => onApply(pendingIds)} />
        <Button label="Discard all" size="sm" variant="ghost" isDisabled={pending.length === 0 || busy} onClick={() => onDiscard(pendingIds)} />
      </HStack>
      {proposals.map((proposal) => (
        <ProposalRow
          key={proposal.id}
          proposal={proposal}
          isBusy={busyIds.has(proposal.id)}
          onApply={proposal.status === "pending" ? () => onApply([proposal.id]) : undefined}
          onDiscard={proposal.status === "pending" ? () => onDiscard([proposal.id]) : undefined}
        />
      ))}
    </VStack>
  );
}
