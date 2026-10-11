"use client";

/**
 * Header of the cycle detail (docs/contracts/ui.md "Cycles (E1)"): name,
 * status, range, days left, "Add existing" (open cycles), the progress panel
 * toggle and the cycle menu. A completed cycle says it is read-only; an
 * archived one shows an info Banner with Restore.
 */
import { useTransition } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { Token, type TokenColor } from "@astryxdesign/core/Token";
import { unarchiveCycleAction } from "@/app/actions/cycles";
import type { Cycle, CycleStatus } from "@/lib/tessera/types";
import { BurndownIcon, CalendarDotsIcon, PlusIcon, RestoreIcon, TimerIcon } from "@/themes/catppuccin/icons";
import { CYCLE_STATUS_LABEL, daysLeftLabel, formatCycleRange } from "./cycle-format";
import { CycleMenu, failureText } from "./CycleMenu";

export type CycleHeaderProps = {
  projectId: string;
  cycle: Cycle;
  today: string;
  isPanelOpen: boolean;
  /** True while the peek shows a work item: its panel holds the progress panel's place, so the toggle is disabled. */
  isPanelBlocked?: boolean;
  onTogglePanel: () => void;
  /** Absent when the cycle takes no items (completed or archived). */
  onAddExisting?: () => void;
  isEditOpen: boolean;
  onEditOpenChange: (open: boolean) => void;
  onDeleted: () => void;
};

const STATUS_TOKEN: Record<CycleStatus, TokenColor> = { current: "blue", upcoming: "gray", completed: "green", draft: "gray" };

export function CycleHeader({
  projectId,
  cycle,
  today,
  isPanelOpen,
  isPanelBlocked = false,
  onTogglePanel,
  onAddExisting,
  isEditOpen,
  onEditOpenChange,
  onDeleted,
}: CycleHeaderProps) {
  const toast = useToast();
  const [isRestoring, startRestore] = useTransition();
  const isArchived = cycle.archived_at !== null;

  const restore = () => {
    startRestore(async () => {
      const result = await unarchiveCycleAction({ cycle_id: cycle.id });
      if (result.ok) toast({ type: "info", body: `Restored ${cycle.name}` });
      else toast({ type: "error", body: failureText("restore", cycle.name, result.message) });
    });
  };

  return (
    <VStack gap={3} paddingInline={5} paddingBlock={4} className="tessera-planning-detail-header">
      {isArchived ? (
        <Banner
          status="info"
          title="This cycle is archived"
          description="Restore it to change it or add work items."
          endContent={<Button variant="secondary" size="sm" label="Restore" icon={<RestoreIcon />} onClick={restore} isLoading={isRestoring} />}
        />
      ) : null}
      <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
        <HStack gap={3} vAlign="center" wrap="wrap">
          <Heading level={2}>{cycle.name}</Heading>
          <Token label={isArchived ? "Archived" : CYCLE_STATUS_LABEL[cycle.status]} color={isArchived ? "gray" : STATUS_TOKEN[cycle.status]} size="sm" />
        </HStack>
        <HStack gap={2} vAlign="center">
          {onAddExisting ? <Button variant="secondary" size="sm" label="Add existing" icon={<PlusIcon />} onClick={onAddExisting} /> : null}
          <IconButton
            variant="ghost"
            size="sm"
            label={isPanelOpen ? "Hide progress" : "Show progress"}
            tooltip={isPanelBlocked ? "Close the work item to show progress" : isPanelOpen ? "Hide progress" : "Show progress"}
            icon={<BurndownIcon />}
            isDisabled={isPanelBlocked}
            onClick={onTogglePanel}
          />
          <CycleMenu projectId={projectId} cycle={cycle} today={today} isEditOpen={isEditOpen} onEditOpenChange={onEditOpenChange} onDeleted={onDeleted} />
        </HStack>
      </HStack>
      <HStack gap={4} vAlign="center" wrap="wrap">
        <HStack gap={1.5} vAlign="center">
          <Icon icon={CalendarDotsIcon} size="sm" color="secondary" />
          <Text type="supporting">{formatCycleRange(cycle.start_date, cycle.end_date)}</Text>
        </HStack>
        {cycle.status === "current" && cycle.end_date && !isArchived ? (
          <HStack gap={1.5} vAlign="center">
            <Icon icon={TimerIcon} size="sm" color="secondary" />
            <Text type="supporting">{daysLeftLabel(cycle.end_date, today)}</Text>
          </HStack>
        ) : null}
      </HStack>
      {cycle.status === "completed" && !isArchived ? (
        <Text type="supporting">{cycle.open_count > 0 ? "Completed cycles are read-only. Transfer the open items to keep working on them." : "Completed cycles are read-only."}</Text>
      ) : null}
    </VStack>
  );
}
