"use client";

/**
 * Cycles of a project (docs/contracts/ui.md "Cycles (E1)", "Shell" › "Panel
 * headers"): a full-width panel page whose sub-header holds the "Cycles"
 * heading with its count and "New cycle" (the project frame above holds the
 * `h1` and the tabs, so there is no second title row). Under it scroll the
 * current cycle's summary card and one list per non-empty section (Current,
 * Upcoming, Completed, Draft) in engine order, their text on the panel
 * header's 16px inset. `?create=1` (what `n c` pushes) opens the create
 * dialog once and is dropped from the URL so a reload does not reopen it.
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { List } from "@astryxdesign/core/List";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { PanelBar, PanelHeader, PanelPage } from "@/components/shell/PanelHeader";
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

  // A row's text sits 8px inside the row (Astryx's item inset), so the content column is inset 8px and the
  // card and the section labels another 8px: everything lines up with the panel header's 16px.
  // The extra end padding lets the last row's menu scroll clear of the bottom-end toasts and the dev indicator.
  return (
    <>
      <PanelPage
        header={
          <PanelHeader label="Cycles">
            <PanelBar
              size="subheader"
              start={
                <>
                  <Heading level={4} accessibilityLevel={2} maxLines={1}>
                    Cycles
                  </Heading>
                  <Badge variant="purple" label={String(cycles.length)} />
                </>
              }
              end={newButton}
            />
          </PanelHeader>
        }
      >
        <VStack gap={5} paddingInline={2} paddingBlockStart={4} paddingBlockEnd={10} className="tessera-planning-screen">
          {cycles.length === 0 ? (
            <EmptyState
              icon={<Icon icon={CycleIcon} size="lg" color="secondary" />}
              title="No cycles yet"
              description="A cycle is a dated window of work. Create one and add work items to it."
              actions={newButton}
            />
          ) : (
            <>
              {active ? (
                <VStack paddingInline={2}>
                  <ActiveCycleSummary projectId={projectId} data={active} />
                </VStack>
              ) : null}
              {sections.map((section) => (
                <List
                  key={section.key}
                  hasDividers
                  header={
                    <HStack paddingInline={2}>
                      <Text type="label" color="secondary">
                        {section.label}
                      </Text>
                    </HStack>
                  }
                >
                  {section.cycles.map((cycle) => (
                    <CycleRow key={cycle.id} projectId={projectId} cycle={cycle} today={today} />
                  ))}
                </List>
              ))}
            </>
          )}
        </VStack>
      </PanelPage>
      <CycleDialog projectId={projectId} isOpen={isCreateOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
