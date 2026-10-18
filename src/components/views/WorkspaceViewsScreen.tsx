"use client";

/**
 * Workspace views (docs/drafts/p9-plan.md U3): the four static views, then
 * saved workspace views. `?create=1` opens New view once and leaves the URL.
 */
import { useEffect, useState } from "react";
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
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import { ViewDialog } from "@/components/views/ViewDialog";
import { ViewRow } from "@/components/views/ViewRow";
import { STATIC_WORKSPACE_VIEWS } from "@/lib/tessera/schemas";
import type { View } from "@/lib/tessera/types";
import { PlusIcon, TableIcon } from "@/themes/catppuccin/icons";
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
  const ordered = sort === "name" ? [...views].sort((a, b) => a.name.localeCompare(b.name)) : views;
  const saved = ordered.filter((view) => matches(view.name, view.description));
  const canReorder = sort === "manual" && needle === "";

  return (
    <>
      <PanelPage
        header={
          <PanelHeader label="Workspace views">
            <PanelBar
              canWrap
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
        <VStack gap={6} padding={4} className="tessera-workspace-views">
          {staticRows.length === 0 && saved.length === 0 ? (
            <EmptyState isCompact title="No views match" />
          ) : (
            <>
              {staticRows.length > 0 ? (
                <VStack gap={2}>
                  <Heading level={2}>Default views</Heading>
                  <List density="compact" hasDividers>
                    {staticRows.map((view) => (
                      <ListItem
                        key={view.key}
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
                <Heading level={2}>Saved views</Heading>
                {views.length === 0 ? (
                  <EmptyState isCompact title="No saved views" description="Save filters and display options as a workspace view." />
                ) : saved.length === 0 ? (
                  <EmptyState isCompact title="No views match" />
                ) : (
                  <List density="compact" hasDividers>
                    {saved.map((view, index) => (
                      <ViewRow
                        key={view.id}
                        projectId={null}
                        view={view}
                        count={counts[view.id] ?? 0}
                        isFavorite={favorites.has(view.id)}
                        previousId={saved[index - 1]?.id}
                        nextId={saved[index + 1]?.id}
                        canReorder={canReorder}
                      />
                    ))}
                  </List>
                )}
              </VStack>
            </>
          )}
        </VStack>
      </PanelPage>
      <ViewDialog isOpen={isCreateOpen} onOpenChange={setCreateOpen} projectId={null} mode="create" title="New view" />
    </>
  );
}
