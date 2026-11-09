"use client";

/**
 * Small pieces the requests table and the History section share (decision
 * 145): a stage as a dot and its label, and a pull request as an external link.
 */
import type { MouseEvent } from "react";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Link } from "@astryxdesign/core/Link";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import type { PullRequest, Stage } from "@/lib/superagent/types";
import { prLabel, stageVariant } from "./superagent-format";

/** The stage's dot and label (a dot alone carries the status by colour), and its reason as supporting text below when `hasReason`. */
export function StageLabel({ stage, hasReason = false }: { stage: Stage; hasReason?: boolean }) {
  return (
    <VStack gap={0.5}>
      <HStack gap={2} vAlign="center">
        <StatusDot variant={stageVariant(stage.kind)} label={stage.label} />
        <Text>{stage.label}</Text>
      </HStack>
      {hasReason && stage.reason !== null ? (
        <Text type="supporting" color="secondary">
          {stage.reason}
        </Text>
      ) : null}
    </VStack>
  );
}

/** The pull request as its number and state (the label `prLabel` writes), linking to it in a new tab, or "None". */
export function PullRequestLink({ pr, onClick }: { pr: PullRequest | null; onClick?: (event: MouseEvent) => void }) {
  if (pr === null) {
    return (
      <Text type="supporting" color="secondary">
        None
      </Text>
    );
  }
  return (
    <Link href={pr.url} isExternalLink onClick={onClick} className="tessera-superagent-link">
      {prLabel(pr)}
    </Link>
  );
}
