"use client";

/**
 * "Add existing work items" for cycles and modules (docs/contracts/ui.md
 * "Shared planning pieces"). The candidates come with the detail page (no
 * search request); a filter field narrows them by key or name and each row
 * is a checkbox the whole row toggles (`interactiveRef`, one tab stop per
 * row). For a cycle the dialog also drops items it cannot take: members, and
 * items held by a completed cycle or by a cycle the bundle no longer lists
 * (archived). Module candidates arrive without members already.
 */
import { useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useProject } from "@/components/work-items/project-provider";
import type { Cycle } from "@/lib/tessera/types";
import type { ItemCandidate, ProgressTarget } from "./types";

export type AddExistingItemsDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Add work items to Sprint 1". */
  title: string;
  target: ProgressTarget;
  candidates: ItemCandidate[];
  /** The screen calls addWorkItemsTo{Cycle,Module}Action; true closes. */
  onAdd: (ids: string[]) => Promise<boolean>;
};

const MAX_ROWS = 500;

/** Candidates the target can take: for a cycle, not already in it and not held by a completed or archived cycle. */
export function eligibleCandidates(candidates: readonly ItemCandidate[], target: ProgressTarget, cycles: readonly Pick<Cycle, "id" | "status">[]): ItemCandidate[] {
  if (target.type === "module") return candidates.slice(0, MAX_ROWS);
  const statusById = new Map(cycles.map((cycle) => [cycle.id, cycle.status]));
  return candidates
    .filter((item) => {
      if (item.cycle_id === null) return true;
      if (item.cycle_id === target.cycle_id) return false;
      const status = statusById.get(item.cycle_id);
      return status !== undefined && status !== "completed";
    })
    .slice(0, MAX_ROWS);
}

/** Case-insensitive match on key or name. */
export function matchesFilter(item: Pick<ItemCandidate, "key" | "name">, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (needle === "") return true;
  return item.key.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle);
}

export function AddExistingItemsDialog({ isOpen, onOpenChange, ...props }: AddExistingItemsDialogProps) {
  return (
    // Named explicitly: the Dialog reads its DialogHeader title only when the <dialog> attaches, and the form below mounts later.
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={560} maxHeight="80dvh" aria-label={props.title}>
      {isOpen ? <AddExistingForm onOpenChange={onOpenChange} {...props} /> : null}
    </Dialog>
  );
}

function CandidateRow({ item, selected, onToggle }: { item: ItemCandidate; selected: boolean; onToggle: (id: string, checked: boolean) => void }) {
  const rowRef = useRef<HTMLInputElement>(null);
  return (
    <ListItem
      label={
        <>
          {item.key} {item.name}
        </>
      }
      interactiveRef={rowRef}
      startContent={<CheckboxInput label={`${item.key} ${item.name}`} isLabelHidden value={selected} onChange={(checked) => onToggle(item.id, checked)} ref={rowRef} />}
    />
  );
}

function AddExistingForm({ onOpenChange, title, target, candidates, onAdd }: Omit<AddExistingItemsDialogProps, "isOpen">) {
  const { bundle } = useProject();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [isPending, startTransition] = useTransition();

  const eligible = useMemo(() => eligibleCandidates(candidates, target, bundle.cycles), [candidates, target, bundle.cycles]);
  const visible = eligible.filter((item) => matchesFilter(item, filter));
  const chosen = eligible.filter((item) => selected.has(item.id)).map((item) => item.id);

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const submit = () => {
    if (chosen.length === 0 || isPending) return;
    startTransition(async () => {
      const ok = await onAdd(chosen);
      if (ok) onOpenChange(false);
    });
  };

  const close = () => {
    if (!isPending) onOpenChange(false);
  };

  return (
    <Layout
      header={<DialogHeader title={title} onOpenChange={close} hasDivider />}
      content={
        <LayoutContent>
          <VStack gap={3}>
            <TextInput label="Filter" value={filter} onChange={setFilter} placeholder="Key or name" hasClear hasAutoFocus />
            {eligible.length === 0 ? (
              <EmptyState isCompact title="Nothing to add" description="Every open work item of the project is already here or cannot join." />
            ) : visible.length === 0 ? (
              <EmptyState isCompact title="Nothing to add" description="No work item matches the filter." />
            ) : (
              <List density="compact" aria-label="Work items">
                {visible.map((item) => (
                  <CandidateRow key={item.id} item={item} selected={selected.has(item.id)} onToggle={toggle} />
                ))}
              </List>
            )}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} hAlign="end">
            <Button variant="ghost" label="Cancel" onClick={close} isDisabled={isPending} />
            <Button
              variant="primary"
              label={chosen.length === 1 ? "Add 1 work item" : `Add ${chosen.length} work items`}
              onClick={submit}
              isLoading={isPending}
              isDisabled={chosen.length === 0}
            />
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
