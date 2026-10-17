"use client";

/**
 * Modules list of a project (docs/contracts/ui.md "Modules (E2)", "Shell" ›
 * "Panel headers"): a full-width panel page whose sub-header holds the
 * "Modules" heading with its count (the frame holds the `h1`) and "New
 * module", then one scrolling `List` of `ModuleRow`s in engine order
 * (`sort_order`, then creation), the rows' text on the header's 16px inset;
 * no modules → `EmptyState` "No modules yet". `?create=1` (Power K `n m`)
 * opens the create dialog once and is then dropped with `router.replace`, as
 * on the work items screen.
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { List } from "@astryxdesign/core/List";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Text";
import { PanelBar, PanelHeader, PanelPage } from "@/components/shell/PanelHeader";
import type { Module } from "@/lib/tessera/types";
import { useProject } from "@/components/work-items/project-provider";
import { ModuleIcon, PlusIcon } from "@/themes/catppuccin/icons";
import { ModuleDialog } from "./ModuleDialog";
import { ModuleRow } from "./ModuleRow";

export type ModulesScreenProps = {
  projectId: string;
  /** Non-archived modules in engine order. */
  modules: Module[];
  /** `ctx.today()`; the P3 list shows no day counts, the P10 timeline uses it. */
  today: string;
  /** `?create=1`: open the create dialog. */
  createOnOpen: boolean;
};

export function ModulesScreen({ projectId, modules, createOnOpen }: ModulesScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isCreateOpen, setCreateOpen] = useState(false);
  // An archived project takes no new modules and its row menus are disabled (F3.4, see ModuleMenu).
  const { bundle } = useProject();
  const isReadOnly = bundle.project.archived_at !== null;

  // Open once per request: the flag stays true until the replace below lands, and Next keeps the screen mounted.
  const [createRequestSeen, setCreateRequestSeen] = useState(false);
  if (createOnOpen && !createRequestSeen) {
    setCreateRequestSeen(true);
    setCreateOpen(!isReadOnly);
  } else if (!createOnOpen && createRequestSeen) {
    setCreateRequestSeen(false);
  }

  useEffect(() => {
    if (!createOnOpen) return;
    // Drop the param so a reload does not reopen the dialog.
    const params = new URLSearchParams(searchParams.toString());
    params.delete("create");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the flag only; pathname and params are read when it flips
  }, [createOnOpen]);

  // A row's text sits 8px inside the row (Astryx's item inset): with the list inset 8px it lines up with the
  // panel header's 16px. The extra end padding lets the last row's menu scroll clear of the bottom-end toasts
  // and the dev indicator.
  return (
    <>
      <PanelPage
        header={
          <PanelHeader label="Modules">
            <PanelBar
              size="subheader"
              start={
                <>
                  <Heading level={4} accessibilityLevel={2} maxLines={1}>
                    Modules
                  </Heading>
                  <Badge variant="purple" label={String(modules.length)} />
                </>
              }
              end={isReadOnly ? undefined : <Button variant="primary" size="sm" label="New module" icon={<PlusIcon />} onClick={() => setCreateOpen(true)} />}
            />
          </PanelHeader>
        }
      >
        {modules.length === 0 ? (
          <VStack padding={8} hAlign="center">
            <EmptyState
              icon={<Icon icon={ModuleIcon} size="lg" color="secondary" />}
              title="No modules yet"
              description="Modules group work items into a deliverable with a lead, members and a target date."
            />
          </VStack>
        ) : (
          <VStack gap={0} paddingInline={2} paddingBlockStart={2} paddingBlockEnd={10}>
            <List hasDividers aria-label="Modules" className="tessera-modules-list">
              {modules.map((module) => (
                <ModuleRow key={module.id} projectId={projectId} module={module} />
              ))}
            </List>
          </VStack>
        )}
      </PanelPage>
      {isReadOnly ? null : <ModuleDialog projectId={projectId} isOpen={isCreateOpen} onOpenChange={setCreateOpen} />}
    </>
  );
}
