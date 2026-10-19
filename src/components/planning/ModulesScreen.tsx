"use client";

/**
 * Modules list of a project (docs/contracts/ui.md "Modules (E2)", decision 108):
 * a full-width panel page whose sub-header holds the "Modules" heading with its
 * count, a List/Timeline layout switch (`?layout=`), and "New module"; then
 * either the scrolling `List` of `ModuleRow`s or `ModulesTimeline`. `?create=1`
 * (Power K `n m`) opens the create dialog once and is then dropped.
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { List } from "@astryxdesign/core/List";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Text";
import { PanelBar, PanelHeader, PanelPage } from "@/components/shell/PanelHeader";
import type { Module } from "@/lib/tessera/types";
import { useProject } from "@/components/work-items/project-provider";
import { GanttIcon, ModuleIcon, PlusIcon, RowsIcon } from "@/themes/catppuccin/icons";
import { ModuleDialog } from "./ModuleDialog";
import { ModuleRow } from "./ModuleRow";
import { ModulesTimeline } from "./ModulesTimeline";

export type ModulesScreenProps = {
  projectId: string;
  /** Non-archived modules in engine order. */
  modules: Module[];
  /** `ctx.today()`; drives relative dates and the timeline. */
  today: string;
  /** `?create=1`: open the create dialog. */
  createOnOpen: boolean;
  /** `?layout=timeline` shows the gantt over modules; default list. */
  layout?: "list" | "timeline";
};

export function ModulesScreen({ projectId, modules, today, createOnOpen, layout = "list" }: ModulesScreenProps) {
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

  const setLayout = (next: "list" | "timeline") => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "list") params.delete("layout");
    else params.set("layout", "timeline");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

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
                  <SegmentedControl label="Layout" size="sm" value={layout} onChange={(value) => (value === "list" || value === "timeline") && setLayout(value)}>
                    <SegmentedControlItem value="list" label="List" isLabelHidden icon={<RowsIcon />} />
                    <SegmentedControlItem value="timeline" label="Timeline" isLabelHidden icon={<GanttIcon />} />
                  </SegmentedControl>
                </>
              }
              end={isReadOnly ? undefined : <Button variant="primary" size="sm" label="New module" icon={<PlusIcon />} onClick={() => setCreateOpen(true)} />}
            />
          </PanelHeader>
        }
      >
        {layout === "timeline" ? (
          <ModulesTimeline projectId={projectId} modules={modules} today={today} readOnly={isReadOnly} />
        ) : modules.length === 0 ? (
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
