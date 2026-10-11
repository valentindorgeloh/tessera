"use client";

/**
 * Header of the module detail (docs/contracts/ui.md "Modules (E2)"): the
 * name, the status as an inline selector that saves on change, "Add
 * existing" (opens `AddExistingItemsDialog`), the side panel toggle and the
 * module menu. An archived module shows an info `Banner` with Restore, its
 * status is read-only, "Add existing" is gone and the menu offers Restore and
 * Delete only.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { LayoutHeader } from "@astryxdesign/core/Layout";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { addWorkItemsToModuleAction, unarchiveModuleAction } from "@/app/actions/modules";
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

export function ModuleHeader({ projectId, module, writer, candidates, isPanelOpen, isPanelBlocked = false, onTogglePanel }: ModuleHeaderProps) {
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
    <LayoutHeader hasDivider padding={0} label={module.name}>
      <VStack gap={3} paddingInline={5} paddingBlock={3}>
        <HStack gap={3} vAlign="center" wrap="wrap" className="tessera-modules-header">
          <HStack gap={2} vAlign="center" className="tessera-modules-header-title">
            <Heading level={2} maxLines={1}>
              {module.name}
            </Heading>
            <ModuleStatusControl size="sm" value={module.status} readOnly={isArchived} onChange={(status) => writer.update({ status })} />
          </HStack>
          <HStack gap={2} vAlign="center">
            {isArchived ? null : <Button variant="secondary" size="sm" label="Add existing" icon={<PlusIcon />} onClick={() => setAddOpen(true)} />}
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
          </HStack>
        </HStack>
        {isArchived ? (
          <Banner
            status="info"
            title="This module is archived"
            description="Restore it to change it or add work items."
            endContent={<Button variant="secondary" size="sm" label="Restore" icon={<RestoreIcon />} onClick={restore} isLoading={isRestoring} />}
          />
        ) : null}
      </VStack>
      {isArchived ? null : (
        <AddExistingItemsDialog
          isOpen={isAddOpen}
          onOpenChange={setAddOpen}
          title={`Add work items to ${module.name}`}
          target={{ type: "module", module_id: module.id }}
          candidates={candidates}
          onAdd={addItems}
        />
      )}
    </LayoutHeader>
  );
}
