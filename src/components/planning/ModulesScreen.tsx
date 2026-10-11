"use client";

/**
 * Modules list of a project (docs/contracts/ui.md "Modules (E2)"): a header
 * with "Modules" (the frame holds the `h1`) and "New module", then one `List`
 * of `ModuleRow`s in engine order (`sort_order`, then creation); no modules →
 * `EmptyState` "No modules yet". `?create=1` (Power K `n m`) opens the create
 * dialog once and is then dropped with `router.replace`, as on the work items
 * screen.
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { List } from "@astryxdesign/core/List";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading } from "@astryxdesign/core/Text";
import type { Module } from "@/lib/tessera/types";
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

  // Open once per request: the flag stays true until the replace below lands, and Next keeps the screen mounted.
  const [createRequestSeen, setCreateRequestSeen] = useState(false);
  if (createOnOpen && !createRequestSeen) {
    setCreateRequestSeen(true);
    setCreateOpen(true);
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

  // The extra end padding lets the last row's menu scroll clear of the bottom-end toasts and the dev indicator.
  return (
    <VStack gap={0} paddingBlockEnd={10} className="tessera-modules-screen">
      <HStack gap={2} vAlign="center" hAlign="between" paddingInline={5} paddingBlock={3}>
        <Heading level={2}>Modules</Heading>
        <Button variant="primary" size="sm" label="New module" icon={<PlusIcon />} onClick={() => setCreateOpen(true)} />
      </HStack>
      {modules.length === 0 ? (
        <VStack padding={8} hAlign="center">
          <EmptyState
            icon={<Icon icon={ModuleIcon} size="lg" color="secondary" />}
            title="No modules yet"
            description="Modules group work items into a deliverable with a lead, members and a target date."
          />
        </VStack>
      ) : (
        <List hasDividers aria-label="Modules" className="tessera-modules-list">
          {modules.map((module) => (
            <ModuleRow key={module.id} projectId={projectId} module={module} />
          ))}
        </List>
      )}
      <ModuleDialog projectId={projectId} isOpen={isCreateOpen} onOpenChange={setCreateOpen} />
    </VStack>
  );
}
