"use client";

/**
 * One proposal (docs/drafts/p5-plan.md §6). U3 renders the same row for a
 * view made from a prompt and passes its own Apply. Pending rows offer Apply
 * and Discard; a destructive Apply is the caller's choice to confirm first.
 */
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import type { ProposalView } from "@/lib/tessera/types";
import { CheckIcon } from "@/themes/catppuccin/icons";
import { proposalPhase } from "./assistant-store";

function fieldChange(before: string | null, after: string | null): string {
  return `${before ?? "None"} → ${after ?? "None"}`;
}

function StatusChip({ proposal }: { proposal: ProposalView }) {
  const phase = proposalPhase(proposal);
  if (phase === "pending") return null;
  if (phase === "applying") return <Token label="Applying" size="sm" color="yellow" />;
  if (phase === "applied") return <Token label="Applied" size="sm" color="green" icon={<Icon icon={CheckIcon} size="sm" />} />;
  if (phase === "discarded") return <Token label="Discarded" size="sm" color="gray" />;
  if (phase === "expired") return <Token label="Expired" size="sm" color="orange" />;
  return <Token label="Failed" size="sm" color="red" />;
}

export function ProposalRow({
  proposal,
  onApply,
  onDiscard,
  isBusy = false,
}: {
  proposal: ProposalView;
  onApply?: () => void;
  onDiscard?: () => void;
  isBusy?: boolean;
}) {
  const pending = proposal.status === "pending";
  const failed = proposalPhase(proposal) === "failed" ? proposal.error : null;
  return (
    <VStack gap={2} className="tessera-ai-proposal">
      <HStack gap={2} vAlign="center">
        <Text weight="medium">{proposal.preview.title || proposal.title}</Text>
        <StatusChip proposal={proposal} />
      </HStack>
      {proposal.preview.fields.length > 0 ? (
        <MetadataList columns="single">
          {proposal.preview.fields.map((field) => (
            <MetadataListItem key={field.field} label={field.label}>
              {fieldChange(field.before, field.after)}
            </MetadataListItem>
          ))}
        </MetadataList>
      ) : null}
      {proposal.preview.note ? (
        <Text type="supporting" color="secondary">
          {proposal.preview.note}
        </Text>
      ) : null}
      {failed ? (
        <Text type="supporting" color="secondary">
          {failed.message}
        </Text>
      ) : null}
      {pending ? (
        <HStack gap={1} vAlign="center">
          {onApply ? <Button label="Apply" size="sm" isDisabled={isBusy} onClick={onApply} /> : null}
          {onDiscard ? <Button label="Discard" size="sm" variant="ghost" isDisabled={isBusy} onClick={onDiscard} /> : null}
        </HStack>
      ) : null}
    </VStack>
  );
}
