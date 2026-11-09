"use client";

/**
 * Create and edit a cycle (docs/contracts/ui.md "Cycles (E1)"): name,
 * description (plain Markdown) and the date range. The picker disables the
 * days of every other cycle of the project (`overlapCandidates` over the
 * bundle), converting the picker's local `Date`s with local getters. No dates
 * keeps the cycle a draft. Edits send only the changed fields; the dates
 * always change together. CONFLICT (overlap) and VALIDATION from the engine
 * show on the date field, anything else as a Toast.
 */
import { useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { DateRangeInput, type DateRange } from "@astryxdesign/core/DateRangeInput";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { HStack } from "@astryxdesign/core/Stack";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { createCycleAction, updateCycleAction } from "@/app/actions/cycles";
import { useProject } from "@/components/work-items/project-provider";
import { useWeekStart } from "@/components/workspace-settings/workspace-settings-store";
import type { Cycle } from "@/lib/tessera/types";
import { isDayTaken, localIsoDate, overlapCandidates, rangeOverlaps } from "./cycle-format";

export type CycleDialogProps = {
  projectId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit when set. */
  cycle?: Cycle;
};

const NAME_MAX = 120;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type IsoDate = DateRange["start"];

/** Narrows stored dates to the picker's range type; null unless both are well-formed. */
function toRange(start: string | null, end: string | null): DateRange | null {
  if (start === null || end === null || !ISO_DATE.test(start) || !ISO_DATE.test(end)) return null;
  // The engine stores YYYY-MM-DD (IsoDateSchema); the regex above checks the shape the template type names.
  return { start: start as IsoDate, end: end as IsoDate };
}

export function CycleDialog({ isOpen, onOpenChange, ...props }: CycleDialogProps) {
  return (
    // Named explicitly: the Dialog reads its DialogHeader title only when the <dialog> attaches, and the form below mounts later.
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={520} aria-label={props.cycle ? `Edit ${props.cycle.name}` : "New cycle"}>
      {isOpen ? <CycleForm onOpenChange={onOpenChange} {...props} /> : null}
    </Dialog>
  );
}

function CycleForm({ projectId, onOpenChange, cycle }: Omit<CycleDialogProps, "isOpen">) {
  const toast = useToast();
  const { bundle } = useProject();
  // The picker's first weekday is the workspace setting, like every other date picker.
  const weekStartsOn = useWeekStart(bundle.week_start);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(cycle?.name ?? "");
  const [description, setDescription] = useState(cycle?.description_md ?? "");
  const [range, setRange] = useState<DateRange | null>(() => toRange(cycle?.start_date ?? null, cycle?.end_date ?? null));
  const [dateError, setDateError] = useState<string | null>(null);

  const others = overlapCandidates(bundle.cycles, cycle?.id ?? null);
  const overlapping = range ? others.find((other) => rangeOverlaps(range.start, range.end, [other])) : undefined;
  const trimmed = name.trim();
  const nameError = name.length > NAME_MAX ? `Use at most ${NAME_MAX} characters.` : null;
  const shownDateError = dateError ?? (overlapping ? `The dates overlap cycle "${overlapping.name}"` : null);
  const canSubmit = trimmed !== "" && nameError === null && overlapping === undefined && !isPending;

  const dayIsFree = (date: Date) => !isDayTaken(localIsoDate(date), others);

  const submit = () => {
    if (!canSubmit) return;
    setDateError(null);
    const start_date = range?.start ?? null;
    const end_date = range?.end ?? null;
    startTransition(async () => {
      let result;
      if (cycle) {
        const patch: { name?: string; description_md?: string; start_date?: string | null; end_date?: string | null } = {};
        if (trimmed !== cycle.name) patch.name = trimmed;
        if (description !== (cycle.description_md ?? "")) patch.description_md = description;
        if (start_date !== cycle.start_date || end_date !== cycle.end_date) {
          patch.start_date = start_date;
          patch.end_date = end_date;
        }
        if (Object.keys(patch).length === 0) {
          onOpenChange(false);
          return;
        }
        result = await updateCycleAction({ cycle_id: cycle.id, ...patch });
      } else {
        result = await createCycleAction({
          project_id: projectId,
          name: trimmed,
          description_md: description.trim() ? description : undefined,
          start_date,
          end_date,
        });
      }
      if (!result.ok) {
        if (result.code === "CONFLICT" || result.code === "VALIDATION") setDateError(result.message);
        else toast({ type: "error", body: result.message });
        return;
      }
      toast({ type: "info", body: cycle ? `Saved ${trimmed}` : `Created ${trimmed}` });
      onOpenChange(false);
    });
  };

  const close = () => {
    if (!isPending) onOpenChange(false);
  };

  return (
    <Layout
      header={<DialogHeader title={cycle ? `Edit ${cycle.name}` : "New cycle"} onOpenChange={close} hasDivider />}
      content={
        <LayoutContent>
          <FormLayout className="tessera-dialog-form">
            <TextInput
              label="Name"
              value={name}
              hasAutoFocus
              isRequired
              placeholder="Sprint 1"
              onChange={setName}
              onEnter={submit}
              status={nameError ? { type: "error", message: nameError } : undefined}
            />
            <TextArea label="Description" value={description} onChange={setDescription} rows={3} isOptional placeholder="Goal of the cycle (Markdown)" />
            <DateRangeInput
              controlClassName="tessera-cycle-dates"
              label="Dates"
              description="Days of other cycles are not available. Leave empty to keep the cycle a draft."
              value={range}
              onChange={(next) => {
                setDateError(null);
                setRange(next);
              }}
              hasClear
              isOptional
              weekStartsOn={weekStartsOn}
              dateConstraints={[dayIsFree]}
              status={shownDateError ? { type: "error", message: shownDateError } : undefined}
            />
          </FormLayout>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={close} isDisabled={isPending} />
            <Button variant="primary" label={cycle ? "Save" : "Create cycle"} onClick={submit} isLoading={isPending} isDisabled={!canSubmit} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
