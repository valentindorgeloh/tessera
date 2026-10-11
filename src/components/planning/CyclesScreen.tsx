"use client";

/**
 * Cycles of a project (docs/contracts/ui.md "Cycles (E1)"): a header with
 * "New cycle", the current cycle's summary card, then one list per non-empty
 * section (Current, Upcoming, Completed, Draft) in engine order. `?create=1`
 * (what `n c` pushes) opens the create dialog once and is dropped from the URL
 * so a reload does not reopen it.
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { List } from "@astryxdesign/core/List";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { Cycle } from "@/lib/tessera/types";
import { CycleIcon, PlusIcon } from "@/themes/catppuccin/icons";
import { ActiveCycleSummary } from "./ActiveCycleSummary";
import { CycleDialog } from "./CycleDialog";
import { groupCycles } from "./cycle-format";
import { CycleRow } from "./CycleRow";
import type { CycleDetailData } from "./types";

export type CyclesScreenProps = {
  projectId: string;
  /** Non-archived, engine order. */
  cycles: Cycle[];
  /** The current cycle with full progress, candidates []. */
  active: CycleDetailData | null;
  today: string;
  createOnOpen: boolean;
};

export function CyclesScreen({ projectId, cycles, active, today, createOnOpen }: CyclesScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isCreateOpen, setCreateOpen] = useState(false);

  // React to the flag rather than the mount, so `n c` while this page is open opens the dialog too.
  const [createRequestSeen, setCreateRequestSeen] = useState(false);
  if (createOnOpen && !createRequestSeen) {
    setCreateRequestSeen(true);
    setCreateOpen(true);
  } else if (!createOnOpen && createRequestSeen) {
    setCreateRequestSeen(false);
  }

  useEffect(() => {
    if (!createOnOpen) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("create");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the flag only; pathname and params are read when it flips
  }, [createOnOpen]);

  const sections = groupCycles(cycles);
  const newButton = <Button variant="primary" size="sm" label="New cycle" icon={<PlusIcon />} onClick={() => setCreateOpen(true)} />;

  // The extra end padding lets the last row's menu scroll clear of the bottom-end toasts and the dev indicator.
  return (
    <VStack gap={5} paddingInline={5} paddingBlockStart={5} paddingBlockEnd={10} className="tessera-planning-screen">
      <HStack gap={3} vAlign="center" hAlign="between">
        <Heading level={2}>Cycles</Heading>
        {newButton}
      </HStack>
      {cycles.length === 0 ? (
        <EmptyState
          icon={<Icon icon={CycleIcon} size="lg" color="secondary" />}
          title="No cycles yet"
          description="A cycle is a dated window of work. Create one and add work items to it."
          actions={newButton}
        />
      ) : (
        <>
          {active ? <ActiveCycleSummary projectId={projectId} data={active} /> : null}
          {sections.map((section) => (
            <List
              key={section.key}
              hasDividers
              header={
                <Text type="label" color="secondary">
                  {section.label}
                </Text>
              }
            >
              {section.cycles.map((cycle) => (
                <CycleRow key={cycle.id} projectId={projectId} cycle={cycle} today={today} />
              ))}
            </List>
          ))}
        </>
      )}
      <CycleDialog projectId={projectId} isOpen={isCreateOpen} onOpenChange={setCreateOpen} />
    </VStack>
  );
}
