"use client";

/**
 * The wiki and the project Pages tab (docs/drafts/p6-plan.md "PagesScreen").
 * Public, Private and Archived are `?tab=`. New page creates "Untitled" and
 * opens it; Archived has no create button. A project screen adds no title
 * row: the project frame already has one.
 *
 * ASSUMPTION: a new page on the Private tab is private, so it stays on the
 * tab that created it. Public is the default everywhere else.
 * ASSUMPTION: `spaces` is the active projects with Pages on, which the move
 * dialog needs and the plan's prop list does not name.
 */
import { useEffect, useOptimistic, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { TreeList, type TreeListItemData } from "@astryxdesign/core/TreeList";
import { useToast } from "@astryxdesign/core/Toast";
import { createPageAction, movePageAction } from "@/app/actions/pages";
import { RowDragOverlay, RowGrip } from "@/components/shared/RowDrag";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import { paletteTokenColor } from "@/components/work-items/properties";
import type { Label, PageSummary, PageTab, Project } from "@/lib/tessera/types";
import { DragHandleIcon, LockIcon, PageIcon, PlusIcon, SearchIcon, resolveLogoIcon } from "@/themes/catppuccin/icons";
import { PageRowMenu } from "./PageRowMenu";
import { applyPageMove, type PageMove } from "./page-move";
import { usePageDrag } from "./use-page-drag";
import { pageHref, toTreeItems, withPageTab, type PageSpaceOption, type PageTreeItem } from "./page-tree";

export type PagesScreenProps = {
  space: { kind: "wiki" } | { kind: "project"; project: Project };
  tab: PageTab;
  pages: PageSummary[];
  labels: Label[] | null;
  spaces: readonly PageSpaceOption[];
};

const TABS: readonly { value: PageTab; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
  { value: "archived", label: "Archived" },
];

function isPageTab(value: string): value is PageTab {
  return value === "public" || value === "private" || value === "archived";
}

function rowEnd(node: PageTreeItem, labelsById: ReadonlyMap<string, Label>, menu: ReactNode): ReactNode {
  const chips = node.page.label_ids
    .map((id) => labelsById.get(id))
    .filter((label): label is Label => label !== undefined)
    .slice(0, 2);
  return (
    <HStack gap={1} vAlign="center" className="tessera-page-row-end">
      {node.page.is_locked ? <Icon icon={LockIcon} size="sm" color="secondary" /> : null}
      {chips.map((label) => (
        <Token key={label.id} label={label.name} size="sm" color={paletteTokenColor(label.color)} />
      ))}
      {menu}
    </HStack>
  );
}

export function PagesScreen({ space, tab, pages: serverPages, labels, spaces }: PagesScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [isCreating, startCreate] = useTransition();
  const [, startMove] = useTransition();
  // Dragged order shows at once (decision 13); it drops back to the server list when a move fails.
  const [pages, applyMove] = useOptimistic(serverPages, (current, move: PageMove) => applyPageMove(current, move));
  const project = space.kind === "project" ? space.project : null;
  const projectArchived = project !== null && project.archived_at !== null;
  const canCreate = tab !== "archived" && !projectArchived;
  const labelsById = new Map((labels ?? []).map((label) => [label.id, label]));
  const projectId = project?.id ?? null;

  const selectTab = (value: string) => {
    if (!isPageTab(value) || value === tab) return;
    router.replace(withPageTab(pathname, searchParams.toString(), value), { scroll: false });
  };

  const create = () => {
    startCreate(async () => {
      let result: Awaited<ReturnType<typeof createPageAction>>;
      try {
        result = await createPageAction({
          project_id: projectId,
          name: "Untitled",
          access: tab === "private" ? "private" : "public",
        });
      } catch {
        toast({ type: "error", body: "Could not create the page. The request did not go through." });
        return;
      }
      if (!result.ok) {
        toast({ type: "error", body: `Could not create the page. ${result.message}` });
        return;
      }
      router.push(pageHref(result.data));
    });
  };

  // `?create=1` (what `n d` pushes) creates once and is dropped from the URL.
  const createRequested = searchParams.get("create") === "1";
  useEffect(() => {
    if (!createRequested) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("create");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    if (canCreate) create();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the flag only
  }, [createRequested]);

  const newButton = canCreate ? <Button variant="primary" size="sm" label="New page" icon={<PlusIcon />} onClick={create} isLoading={isCreating} /> : null;
  const tabs = (
    <TabList value={tab} onChange={selectTab} size="sm" aria-label="Page access">
      {TABS.map((item) => (
        <Tab key={item.value} value={item.value} label={item.label} />
      ))}
    </TabList>
  );
  const actions = (
    <HStack gap={2} vAlign="center" wrap="wrap" className="tessera-pages-actions">
      <TextInput label="Search pages" isLabelHidden size="sm" placeholder="Search pages" value={query} onChange={setQuery} startIcon={SearchIcon} hasClear className="tessera-pages-search" />
      {newButton}
    </HStack>
  );

  const move = (input: PageMove) =>
    startMove(async () => {
      applyMove(input);
      // A request that rejects (the network is gone) reverts like a refused move; it must not reach the error boundary (decision 13).
      let failure: string | null = null;
      try {
        const result = await movePageAction(input);
        if (!result.ok) failure = result.message;
      } catch {
        failure = "The request did not go through.";
      }
      if (failure !== null) {
        const name = pages.find((entry) => entry.id === input.page_id)?.name ?? "the page";
        toast({ type: "error", body: `Could not move ${name}. ${failure}` });
      }
    });
  const dragEnabled = tab !== "archived" && query.trim() === "" && !projectArchived;
  // Drag reorder: not in a search (a flat result list), on the Archived tab or in an archived project.
  const { setRoot, handlers, draggingId, registerOverlay, isRowDraggable, rowClassName } = usePageDrag({ pages, enabled: dragEnabled, onMove: move });
  const draggedPage = draggingId === null ? undefined : pages.find((entry) => entry.id === draggingId);

  const items = toTreeItems(pages, query);
  // A tree with a chevron column and grips shifts the grip on a touch screen so the two 44px hit areas do not overlap (pages.css).
  const hasBranches = dragEnabled && items.some((node) => node.children.length > 0);
  const tree = (nodes: readonly PageTreeItem[]): TreeListItemData[] =>
    nodes.map((node) => ({
      id: node.id,
      label: node.name,
      href: node.href,
      className: rowClassName(node.id),
      isExpanded: node.isExpanded && node.children.length > 0,
      startContent: (
        <HStack gap={1} vAlign="center" className={hasBranches ? "tessera-page-row-lead tessera-page-row-lead--branches" : "tessera-page-row-lead"}>
          {isRowDraggable(node.id) ? <RowGrip /> : dragEnabled ? <Icon icon={DragHandleIcon} size="sm" className="tessera-page-grip-spacer" /> : null}
          <Icon icon={node.page.logo ? resolveLogoIcon(node.page.logo.icon) : PageIcon} size="sm" color={node.page.logo?.color} />
        </HStack>
      ),
      endContent: rowEnd(
        node,
        labelsById,
        <PageRowMenu
          page={node.page}
          spaces={spaces}
          spaceName={project?.name}
          previousId={node.previousId}
          nextId={node.nextId}
          onMove={move}
          isDisabled={projectArchived}
        />,
      ),
      children: node.children.length > 0 ? tree(node.children) : undefined,
    }));

  const emptyTitle = tab === "archived" ? "No archived pages" : "No pages yet";
  const emptyDescription = tab === "archived" ? "Archive a page to keep it here." : "Pages hold specs, notes and decisions.";

  return (
    <PanelPage
      width="full"
      header={
        <PanelHeader label={space.kind === "wiki" ? "Wiki" : "Pages"}>
          {space.kind === "wiki" ? (
            <PanelBar start={<PanelTitle>Wiki</PanelTitle>} />
          ) : null}
          <PanelBar size="subheader" tabsBelow className="tessera-pages-bar" start={tabs} end={actions} />
        </PanelHeader>
      }
    >
      <VStack ref={setRoot} {...handlers} gap={2} paddingBlockStart={2} paddingBlockEnd={10}>
        {items.length === 0 ? (
          <EmptyState icon={<Icon icon={PageIcon} />} title={query.trim() === "" ? emptyTitle : "No matching pages"} description={query.trim() === "" ? emptyDescription : "Try a different name."} actions={query.trim() === "" ? (newButton ?? undefined) : undefined} />
        ) : (
          <TreeList items={tree(items)} density="compact" variant="lineGuides" aria-label="Pages" />
        )}
        {draggedPage ? <RowDragOverlay registerOverlay={registerOverlay} icon={draggedPage.logo ? resolveLogoIcon(draggedPage.logo.icon) : PageIcon} color={draggedPage.logo?.color} label={draggedPage.name} /> : null}
      </VStack>
    </PanelPage>
  );
}
