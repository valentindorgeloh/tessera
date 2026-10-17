"use client";

/**
 * Cycle detail (docs/contracts/ui.md "Cycles (E1)"): the cycle's panel header,
 * the scoped work items list the page passes as `children` (a Server
 * Component interleaved into this client screen; it brings its own panel
 * header and its own scroller) and the progress side panel. While an item is
 * open in the peek, its own panel replaces the progress panel and the
 * header's toggle is disabled. The cycle's name labels its recent entry.
 * The digest card sits at the top of the work-item column.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { useToast } from "@astryxdesign/core/Toast";
import { addWorkItemsToCycleAction } from "@/app/actions/cycles";
import { DigestCard } from "@/components/ai/DigestCard";
import { peekIdOf } from "@/components/detail/peek-url";
import { registerEntityLabel } from "@/components/shell/entity-labels";
import { useProject } from "@/components/work-items/project-provider";
import type { DigestView } from "@/lib/tessera/types";
import { AddExistingItemsDialog } from "./AddExistingItemsDialog";
import { CycleHeader } from "./CycleHeader";
import { CycleSidePanel } from "./CycleSidePanel";
import { savePanelPrefs, usePanelPrefs } from "./panel-prefs";
import type { CycleDetailData } from "./types";

export type CycleDetailScreenProps = { projectId: string; data: CycleDetailData; digest: DigestView | null; children: ReactNode };

function workItems(n: number): string {
  return n === 1 ? "1 work item" : `${n} work items`;
}

export function CycleDetailScreen({ projectId, data, digest, children }: CycleDetailScreenProps) {
  const { cycle, pointsProgress, candidates, today } = data;
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const prefs = usePanelPrefs();
  const [isAddOpen, setAddOpen] = useState(false);
  const [isEditOpen, setEditOpen] = useState(false);

  const peekOpen = peekIdOf(searchParams) !== null;
  const isArchived = cycle.archived_at !== null;
  // An archived project is read-only (F3.4): no adding items or dates; the cycle menu disables itself (CycleMenu).
  const { bundle } = useProject();
  const isReadOnly = bundle.project.archived_at !== null;
  const isOpenCycle = !isArchived && cycle.status !== "completed" && !isReadOnly;

  useEffect(() => {
    registerEntityLabel(cycle.id, cycle.name);
  }, [cycle.id, cycle.name]);

  const addItems = async (ids: string[]): Promise<boolean> => {
    const result = await addWorkItemsToCycleAction({ cycle_id: cycle.id, work_item_ids: ids });
    if (!result.ok) {
      toast({ type: "error", body: `Could not add to ${cycle.name}: ${result.message}` });
      return false;
    }
    toast({ type: "info", body: `Added ${workItems(ids.length)} to ${cycle.name}` });
    return true;
  };

  return (
    <>
      <Layout
        height="fill"
        header={
          <CycleHeader
            projectId={projectId}
            cycle={cycle}
            today={today}
            isPanelOpen={prefs.open && !peekOpen}
            isPanelBlocked={peekOpen}
            onTogglePanel={() => savePanelPrefs({ open: !prefs.open })}
            onAddExisting={isOpenCycle ? () => setAddOpen(true) : undefined}
            isEditOpen={isEditOpen}
            onEditOpenChange={setEditOpen}
            onDeleted={() => router.push(`/projects/${projectId}/cycles`)}
            readOnly={isReadOnly}
          />
        }
        content={
          <LayoutContent padding={0} isScrollable>
            <DigestCard kind="cycle" id={cycle.id} digest={digest} />
            {children}
          </LayoutContent>
        }
        end={
          prefs.open && !peekOpen ? (
            <CycleSidePanel cycle={cycle} pointsProgress={pointsProgress} today={today} onAddDates={isOpenCycle ? () => setEditOpen(true) : undefined} />
          ) : undefined
        }
      />
      {isOpenCycle ? (
        <AddExistingItemsDialog
          isOpen={isAddOpen}
          onOpenChange={setAddOpen}
          title={`Add work items to ${cycle.name}`}
          target={{ type: "cycle", cycle_id: cycle.id }}
          candidates={candidates}
          onAdd={addItems}
        />
      ) : null}
    </>
  );
}
