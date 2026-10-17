"use client";

/**
 * Header of the module detail (docs/contracts/ui.md "Modules (E2)", "Shell" ›
 * "Panel headers"): a panel header with one wrapping sub-header row, the name
 * and the status as an inline selector that saves on change at its start,
 * "Add existing" (opens `AddExistingItemsDialog`), the side panel toggle and
 * the module menu at its end. An archived module shows an info `Banner` with
 * Restore in a padded row under the header's hairline, its status is
 * read-only, "Add existing" is gone and the menu offers Restore and Delete
 * only.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { addWorkItemsToModuleAction, unarchiveModuleAction } from "@/app/actions/modules";
import { PanelBar, PanelHeader } from "@/components/shell/PanelHeader";
import type { ModuleDetail } from "@/lib/tessera/types";
import { PlusIcon, RestoreIcon, SidebarIcon } from "@/themes/catppuccin/icons";
import { AddExistingItemsDialog } from "./AddExistingItemsDialog";
import type { ModuleWriter } from "./ModuleDetailScreen";
import { ModuleStatusControl } from "./ModuleDialog";
import { ModuleMenu } from "./ModuleMenu";
import type { ItemCandidate } from "./types";

export type ModuleHeaderProps = {
  projectId: string;
  /** The module with the writes in flight applied. */
  module: ModuleDetail;
  writer: ModuleWriter;
  /** True in an archived project (F3.4): the status is read-only and "Add existing" is gone, as for an archived module. */
  readOnly?: boolean;
  /** "Add existing work items" rows; [] for an archived module. */
  candidates: ItemCandidate[];
  isPanelOpen: boolean;
  /** True while the peek shows a work item: its panel holds the details panel's place, so the toggle is disabled. */
  isPanelBlocked?: boolean;
  onTogglePanel: () => void;
};

/** "1 work item" / "3 work items". */
function workItemCount(count: number): string {
  return count === 1 ? "1 work item" : `${count} work items`;
}

export function ModuleHeader({ projectId, module, writer, readOnly = false, candidates, isPanelOpen, isPanelBlocked = false, onTogglePanel }: ModuleHeaderProps) {
  const router = useRouter();
  const toast = useToast();
  const [isAddOpen, setAddOpen] = useState(false);
  const [isRestoring, startRestore] = useTransition();
  const isArchived = module.archived_at !== null;

  const addItems = async (ids: string[]): Promise<boolean> => {
    const result = await addWorkItemsToModuleAction({ module_id: module.id, work_item_ids: ids });
    if (!result.ok) {
      toast({ type: "error", body: `Could not add the work items: ${result.message}` });
      return false;
    }
    toast({ type: "info", body: `Added ${workItemCount(ids.length)} to ${module.name}` });
    return true;
  };

  const restore = () => {
    startRestore(async () => {
      const result = await unarchiveModuleAction({ module_id: module.id });
      if (result.ok) toast({ type: "info", body: `Restored ${module.name}` });
      else toast({ type: "error", body: `Could not restore ${module.name}: ${result.message}` });
    });
  };

  return (
    <>
      <PanelHeader label={module.name}>
        <PanelBar
          size="subheader"
          canWrap
          className="tessera-planning-detail-bar"
          start={
            <>
              <Heading level={4} accessibilityLevel={2} maxLines={1} className="tessera-planning-detail-title">
                {module.name}
              </Heading>
              <ModuleStatusControl size="sm" value={module.status} readOnly={isArchived || readOnly} onChange={(status) => writer.update({ status })} />
            </>
          }
          end={
            <>
              {isArchived || readOnly ? null : <Button variant="secondary" size="sm" label="Add existing" icon={<PlusIcon />} onClick={() => setAddOpen(true)} />}
              <IconButton
                variant="ghost"
                size="sm"
                icon={<SidebarIcon />}
                label={isPanelOpen ? "Hide details" : "Show details"}
                tooltip={isPanelBlocked ? "Close the work item to show details" : isPanelOpen ? "Hide details" : "Show details"}
                isDisabled={isPanelBlocked}
                onClick={onTogglePanel}
              />
              <ModuleMenu projectId={projectId} module={module} onDeleted={() => router.push(`/projects/${projectId}/modules`)} />
            </>
          }
        />
      </PanelHeader>
      {isArchived ? (
        <VStack paddingInline={4} paddingBlock={2}>
          <Banner
            status="info"
            title="This module is archived"
            description="Restore it to change it or add work items."
            endContent={readOnly ? undefined : <Button variant="secondary" size="sm" label="Restore" icon={<RestoreIcon />} onClick={restore} isLoading={isRestoring} />}
          />
        </VStack>
      ) : null}
      {isArchived || readOnly ? null : (
        <AddExistingItemsDialog
          isOpen={isAddOpen}
          onOpenChange={setAddOpen}
          title={`Add work items to ${module.name}`}
          target={{ type: "module", module_id: module.id }}
          candidates={candidates}
          onAdd={addItems}
        />
      )}
    </>
  );
}
