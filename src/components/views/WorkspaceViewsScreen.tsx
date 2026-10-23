"use client";

/**
 * Workspace views (docs/drafts/p9-plan.md U3): the four static views, then
 * saved workspace views. `?create=1` opens New view once and leaves the URL.
 * The saved list is built like the project views list (ViewsScreen): the
 * same gutter and full-bleed dividers, and the same drag reorder (decision
 * 105) with the menu's Move up / Move down as the keyboard path, optimistic
 * (decision 13). Both are off while the list is sorted by name or searched.
 */
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { List, ListItem } from "@astryxdesign/core/List";
import { Selector } from "@astryxdesign/core/Selector";
import { VStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { RowDragOverlay, RowSlot } from "@/components/shared/RowDrag";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import { ViewDialog } from "@/components/views/ViewDialog";
import { ViewRow } from "@/components/views/ViewRow";
import { STATIC_WORKSPACE_VIEWS } from "@/lib/tessera/schemas";
import type { View } from "@/lib/tessera/types";
import { PlusIcon, TableIcon, ViewIcon, resolveLogoIcon } from "@/themes/catppuccin/icons";
import { useViewReorder } from "./use-view-reorder";
import { VIEWS_CONTAINER } from "./view-reorder";
import "@/components/styles/workspace-views.css";

export type WorkspaceViewsScreenProps = {
  views: View[];
  /** Ids of views that are favourites. */
  favoriteIds: readonly string[];
  counts: Record<string, number>;
  createOnOpen: boolean;
};

type Sort = "manual" | "name";

export function WorkspaceViewsScreen({ views, favoriteIds, counts, createOnOpen: createRequested }: WorkspaceViewsScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const favorites = new Set(favoriteIds);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("manual");

  const [createRequestSeen, setCreateRequestSeen] = useState(false);
  if (createRequested && !createRequestSeen) {
    setCreateRequestSeen(true);
    setCreateOpen(true);
  } else if (!createRequested && createRequestSeen) {
    setCreateRequestSeen(false);
  }

  useEffect(() => {
    if (!createRequested) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("create");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the flag only; pathname and params are read when it flips
  }, [createRequested]);

  const needle = search.trim().toLowerCase();
  const matches = (name: string, description: string) => needle === "" || name.toLowerCase().includes(needle) || description.toLowerCase().includes(needle);
  const staticRows = STATIC_WORKSPACE_VIEWS.filter((view) => matches(view.name, view.description));
  const { ordered: manual, onMove, drag, registerContainer, registerItem, registerOverlay, itemHandlers } = useViewReorder(views);
  const ordered = sort === "name" ? [...manual].sort((a, b) => a.name.localeCompare(b.name)) : manual;
  const saved = ordered.filter((view) => matches(view.name, view.description));
  const canReorder = sort === "manual" && needle === "";

  // The dragged row leaves the list while it is held; a dashed slot marks where it lands.
  const dragged = drag ? manual.find((view) => view.id === drag.id) : undefined;
  const savedRows: ReactNode[] = saved
    .filter((view) => view.id !== drag?.id)
    .map((view) => (
      <ViewRow
        key={view.id}
        projectId={null}
        view={view}
        count={counts[view.id] ?? 0}
        isFavorite={favorites.has(view.id)}
        previousId={saved[saved.indexOf(view) - 1]?.id}
        nextId={saved[saved.indexOf(view) + 1]?.id}
        canReorder={canReorder}
        onMove={(direction) => onMove(view.id, direction)}
        drag={canReorder ? { rowRef: registerItem(view.id), handlers: itemHandlers(view.id, VIEWS_CONTAINER) } : undefined}
      />
    ));
  if (drag?.target) savedRows.splice(Math.min(drag.target.index, savedRows.length), 0, <RowSlot key="slot" height={drag.height} />);

  return (
    <>
      <PanelPage
        header={
          <PanelHeader label="Workspace views">
            <PanelBar
              canWrap
              className="tessera-workspace-views-bar"
              start={
                <>
                  <PanelTitle>Workspace views</PanelTitle>
                  <Badge variant="purple" label={String(views.length)} />
                </>
              }
              end={
                <>
                  <TextInput
                    size="sm"
                    label="Search views"
                    isLabelHidden
                    placeholder="Search views"
                    hasClear
                    value={search}
                    onChange={setSearch}
                    className="tessera-views-search"
                  />
                  <Selector
                    label="Sort"
                    isLabelHidden
                    size="sm"
                    value={sort}
                    onChange={(value) => setSort(value === "name" ? "name" : "manual")}
                    options={[
                      { value: "manual", label: "Manual" },
                      { value: "name", label: "Name" },
                    ]}
                  />
                  <Button variant="primary" size="sm" label="New view" icon={<PlusIcon />} onClick={() => setCreateOpen(true)} />
                </>
              }
            />
          </PanelHeader>
        }
      >
        <VStack gap={6} paddingInline={2} paddingBlockStart={4} paddingBlockEnd={10} className="tessera-workspace-views">
          {staticRows.length === 0 && saved.length === 0 ? (
            <EmptyState isCompact title="No views match" />
          ) : (
            <>
              {staticRows.length > 0 ? (
                <VStack gap={2}>
                  <Heading level={2} className="tessera-workspace-views-heading">
                    Default views
                  </Heading>
                  <List density="compact" hasDividers>
                    {staticRows.map((view) => (
                      <ListItem
                        key={view.key}
                        className="tessera-row-hit"
                        href={`/workspace-views/${view.key}`}
                        startContent={<Icon icon={TableIcon} size="sm" color="secondary" />}
                        label={view.name}
                        description={view.description}
                      />
                    ))}
                  </List>
                </VStack>
              ) : null}
              <VStack gap={2}>
                <Heading level={2} className="tessera-workspace-views-heading">
                  Saved views
                </Heading>
                {views.length === 0 ? (
                  <EmptyState isCompact title="No saved views" description="Save filters and display options as a workspace view." />
                ) : saved.length === 0 ? (
                  <EmptyState isCompact title="No views match" />
                ) : (
                  <List ref={registerContainer(VIEWS_CONTAINER)} density="compact" hasDividers>
                    {savedRows}
                  </List>
                )}
              </VStack>
            </>
          )}
        </VStack>
      </PanelPage>
      {drag && dragged ? (
        <RowDragOverlay registerOverlay={registerOverlay} icon={dragged.logo ? resolveLogoIcon(dragged.logo.icon) : ViewIcon} color={dragged.logo?.color ?? "secondary"} label={dragged.name} />
      ) : null}
      <ViewDialog isOpen={isCreateOpen} onOpenChange={setCreateOpen} projectId={null} mode="create" title="New view" />
    </>
  );
}
