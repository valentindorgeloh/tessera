"use client";

/**
 * Custom snooze (docs/drafts/p7-plan.md §6). The clock is the instant the
 * dialog opened (`openedAt`), so render never calls `Date.now()`. The field
 * runs from that instant through 90 days.
 */
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { DateTimeInput, type ISODateTimeString } from "@astryxdesign/core/DateTimeInput";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack } from "@astryxdesign/core/Stack";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { useWeekStart } from "@/components/workspace-settings/workspace-settings-store";
import { formatLocalDateTime, parseLocalDateTime, snoozeBounds, snoozePresets } from "./inbox-format";

export type SnoozeDialogProps = {
  isOpen: boolean;
  /** Captured in the click that opened the dialog. */
  openedAt: Date | null;
  onOpenChange: (isOpen: boolean) => void;
  onConfirm: (until: Date) => void;
};

function asDateTime(value: string): ISODateTimeString {
  return value as ISODateTimeString;
}

export function SnoozeDialog({ isOpen, openedAt, onOpenChange, onConfirm }: SnoozeDialogProps) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={420} aria-label="Snooze until">
      {isOpen && openedAt ? <SnoozeForm openedAt={openedAt} onOpenChange={onOpenChange} onConfirm={onConfirm} /> : null}
    </Dialog>
  );
}

function SnoozeForm({ openedAt, onOpenChange, onConfirm }: { openedAt: Date; onOpenChange: (isOpen: boolean) => void; onConfirm: (until: Date) => void }) {
  // The inbox has no project bundle: the store answers once the layout's publisher has run, Monday before.
  const weekStartsOn = useWeekStart();
  const bounds = snoozeBounds(openedAt);
  const initial = snoozePresets(openedAt).find((preset) => preset.id === "tomorrow")?.until ?? bounds.min;
  const [value, setValue] = useState(formatLocalDateTime(initial));
  const until = parseLocalDateTime(value);
  const inRange = until !== null && until.getTime() >= bounds.min.getTime() && until.getTime() <= bounds.max.getTime();
  const confirm = () => {
    if (until === null || !inRange) return;
    onConfirm(until);
  };
  return (
    <Layout
      header={<DialogHeader title="Snooze until" onOpenChange={onOpenChange} />}
      content={
        <LayoutContent>
          <DateTimeInput
            label="Snooze until"
            value={asDateTime(value)}
            onChange={(next) => setValue(next ?? formatLocalDateTime(initial))}
            min={asDateTime(formatLocalDateTime(bounds.min))}
            max={asDateTime(formatLocalDateTime(bounds.max))}
            hasClear={false}
            hourFormat="24h"
            weekStartsOn={weekStartsOn}
          />
        </LayoutContent>
      }
      footer={
        <LayoutFooter hasDivider>
          <HStack gap={2} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={() => onOpenChange(false)} />
            <Button variant="primary" label="Snooze" onClick={confirm} isDisabled={!inRange} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
