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
import { useEffect, useState, useTransition, type ReactNode } from "react";
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
import { createPageAction } from "@/app/actions/pages";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import { paletteTokenColor } from "@/components/work-items/properties";
import type { Label, PageSummary, PageTab, Project } from "@/lib/tessera/types";
import { LockIcon, PageIcon, PlusIcon, SearchIcon, resolveLogoIcon } from "@/themes/catppuccin/icons";
import { PageRowMenu } from "./PageRowMenu";
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

export function PagesScreen({ space, tab, pages, labels, spaces }: PagesScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [isCreating, startCreate] = useTransition();
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
      const result = await createPageAction({
        project_id: projectId,
        name: "Untitled",
        access: tab === "private" ? "private" : "public",
      });
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
      <TextInput label="Search pages" isLabelHidden size="sm" value={query} onChange={setQuery} startIcon={SearchIcon} hasClear className="tessera-pages-search" />
      {newButton}
    </HStack>
  );

  const items = toTreeItems(pages, query);
  const tree = (nodes: readonly PageTreeItem[]): TreeListItemData[] =>
    nodes.map((node) => ({
      id: node.id,
      label: node.name,
      href: node.href,
      isExpanded: node.isExpanded && node.children.length > 0,
      startContent: <Icon icon={node.page.logo ? resolveLogoIcon(node.page.logo.icon) : PageIcon} size="sm" color={node.page.logo?.color} />,
      endContent: rowEnd(
        node,
        labelsById,
        <PageRowMenu
          page={node.page}
          spaces={spaces}
          spaceName={project?.name}
          previousId={node.previousId}
          nextId={node.nextId}
          isDisabled={projectArchived}
        />,
      ),
      children: node.children.length > 0 ? tree(node.children) : undefined,
    }));

  const emptyTitle = tab === "archived" ? "No archived pages" : "No pages yet";
  const emptyDescription = tab === "archived" ? "Archive a page to keep it here." : "Pages hold specs, notes and decisions.";

  return (
    <PanelPage
      width={space.kind === "wiki" ? "reading" : "full"}
      header={
        <PanelHeader label={space.kind === "wiki" ? "Wiki" : "Pages"}>
          {space.kind === "wiki" ? (
            <PanelBar start={<PanelTitle>Wiki</PanelTitle>} />
          ) : null}
          <PanelBar size="subheader" canWrap start={tabs} end={actions} />
        </PanelHeader>
      }
    >
      <VStack gap={2} paddingBlockStart={2} paddingBlockEnd={10}>
        {items.length === 0 ? (
          <EmptyState icon={<Icon icon={PageIcon} />} title={query.trim() === "" ? emptyTitle : "No matching pages"} description={query.trim() === "" ? emptyDescription : "Try a different name."} actions={query.trim() === "" ? (newButton ?? undefined) : undefined} />
        ) : (
          <TreeList items={tree(items)} density="compact" variant="lineGuides" aria-label="Pages" />
        )}
      </VStack>
    </PanelPage>
  );
}
