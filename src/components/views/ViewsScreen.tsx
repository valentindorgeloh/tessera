"use client";

/**
 * Saved views of a project (docs/drafts/p4-ui.md "Views list"): a full-width
 * panel page whose sub-header holds the "Views" heading with its count, a
 * name search and "New view" (the project frame above holds the `h1` and the
 * tabs). One row per view in manual order, each with its work item count and
 * a menu. `?create=1` (what `n v` pushes) opens the New view dialog once and
 * is dropped from the URL. An archived project shows the list read-only.
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { List } from "@astryxdesign/core/List";
import { VStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { PanelBar, PanelHeader, PanelPage } from "@/components/shell/PanelHeader";
import { useProject } from "@/components/work-items/project-provider";
import type { View } from "@/lib/tessera/types";
import { PlusIcon, ViewIcon } from "@/themes/catppuccin/icons";
import { ViewDialog } from "./ViewDialog";
import { ViewRow } from "./ViewRow";

export type ViewsScreenProps = {
  projectId: string;
  /** Non-deleted views of the project in manual order. */
  views: View[];
  /** Work item count per view id (`getCounts` of the view's scope). */
  counts: Record<string, number>;
  createOnOpen: boolean;
};

export function ViewsScreen({ projectId, views, counts, createOnOpen: createRequested }: ViewsScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { bundle } = useProject();
  const readOnly = bundle.project.archived_at !== null;
  const createOnOpen = createRequested && !readOnly;
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");

  // React to the flag rather than the mount, so `n v` while this page is open opens the dialog too.
  const [createRequestSeen, setCreateRequestSeen] = useState(false);
  if (createOnOpen && !createRequestSeen) {
    setCreateRequestSeen(true);
    setCreateOpen(true);
  } else if (!createOnOpen && createRequestSeen) {
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
  const shown = needle === "" ? views : views.filter((view) => view.name.toLowerCase().includes(needle));
  const canReorder = needle === "";
  const newButton = readOnly ? null : <Button variant="primary" size="sm" label="New view" icon={<PlusIcon />} onClick={() => setCreateOpen(true)} />;

  return (
    <>
      <PanelPage
        header={
          <PanelHeader label="Views">
            <PanelBar
              size="subheader"
              canWrap
              start={
                <>
                  <Heading level={4} accessibilityLevel={2} maxLines={1}>
                    Views
                  </Heading>
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
                  {newButton}
                </>
              }
            />
          </PanelHeader>
        }
      >
        <VStack gap={5} paddingInline={2} paddingBlockStart={4} paddingBlockEnd={10}>
          {views.length === 0 ? (
            <EmptyState
              icon={<Icon icon={ViewIcon} size="lg" color="secondary" />}
              title="No views yet"
              description="Save filters and display options as a view."
              actions={newButton ?? undefined}
            />
          ) : shown.length === 0 ? (
            <EmptyState isCompact title="No views match" />
          ) : (
            <List density="compact" hasDividers>
              {shown.map((view, index) => (
                <ViewRow
                  key={view.id}
                  projectId={projectId}
                  view={view}
                  count={counts[view.id] ?? 0}
                  previousId={shown[index - 1]?.id}
                  nextId={shown[index + 1]?.id}
                  canReorder={canReorder}
                />
              ))}
            </List>
          )}
        </VStack>
      </PanelPage>
      <ViewDialog isOpen={isCreateOpen} onOpenChange={setCreateOpen} projectId={projectId} mode="create" title="New view" />
    </>
  );
}
