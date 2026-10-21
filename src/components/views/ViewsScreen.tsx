"use client";

/**
 * Saved views of a project (docs/drafts/p4-ui.md "Views list"): a full-width
 * panel page whose sub-header holds the "Views" heading with its count, a
 * name search and "New view" (the project frame above holds the `h1` and the
 * tabs). One row per view in manual order, each with its work item count and
 * a menu. `?create=1` (what `n v` pushes) opens the New view dialog once and
 * is dropped from the URL. `?describe=1` opens Describe a view the same way
 * when the assistant is available. An archived project shows the list read-only.
 * Rows reorder by pointer drag (decision 105) with the menu's Move up and Move
 * down as the keyboard path; the order updates optimistically (decision 13)
 * and snaps back with a toast when the engine refuses. Dragging is off while
 * the search field has text, like the menu moves.
 */
import { startTransition, useEffect, useOptimistic, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { List } from "@astryxdesign/core/List";
import { VStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { reorderViewAction } from "@/app/actions/views";
import { useAiStatus } from "@/components/ai/AiStatusProvider";
import { ViewFromPromptDialog } from "@/components/ai/ViewFromPromptDialog";
import { usePointerDrag, type DragDropEvent } from "@/components/dnd/use-pointer-drag";
import { RowDragOverlay, RowSlot } from "@/components/shared/RowDrag";
import { PanelBar, PanelHeader, PanelPage } from "@/components/shell/PanelHeader";
import { useProject } from "@/components/work-items/project-provider";
import type { View } from "@/lib/tessera/types";
import { PlusIcon, SparkleIcon, ViewIcon, resolveLogoIcon } from "@/themes/catppuccin/icons";
import { ViewDialog } from "./ViewDialog";
import { ViewRow } from "./ViewRow";
import { VIEWS_CONTAINER, moveView, viewDropInput } from "./view-reorder";

/** Controls keep their press; the row's own link does not (a click without travel still opens it). */
const DRAG_IGNORE = 'button, input, textarea, select, [role="menuitem"], [role="menu"], [role="dialog"]';

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
  const { status } = useAiStatus();
  const toast = useToast();
  const readOnly = bundle.project.archived_at !== null;
  const viewsOn = bundle.project.views_enabled;
  const aiAvailable = status?.available === true;
  const createOnOpen = createRequested && !readOnly;
  const describeRequested = searchParams.get("describe") === "1";
  const describeOnOpen = describeRequested && !readOnly && viewsOn && aiAvailable;
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [isDescribeOpen, setDescribeOpen] = useState(false);
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

  // Same as create: open once from `?describe=1`, then drop it. Wait while the status is still loading.
  const [describeRequestSeen, setDescribeRequestSeen] = useState(false);
  if (describeOnOpen && !describeRequestSeen) {
    setDescribeRequestSeen(true);
    setDescribeOpen(true);
  } else if (!describeRequested && describeRequestSeen) {
    setDescribeRequestSeen(false);
  }

  useEffect(() => {
    if (!describeRequested) return;
    if (!readOnly && viewsOn && status === null) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("describe");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the flag and the status; pathname and params are read when they flip
  }, [describeRequested, readOnly, viewsOn, status]);

  const [ordered, applyMove] = useOptimistic(views, (current: View[], move: { id: string; index: number }) => moveView(current, move.id, move.index));
  const needle = search.trim().toLowerCase();
  const shown = needle === "" ? ordered : ordered.filter((view) => view.name.toLowerCase().includes(needle));
  const canReorder = needle === "";
  const canDrag = canReorder && !readOnly;

  const onDrop = (event: DragDropEvent) => {
    const input = viewDropInput(event);
    const moved = ordered.find((view) => view.id === event.id);
    if (input === null || moved === undefined) return;
    startTransition(async () => {
      applyMove({ id: event.id, index: event.index });
      const result = await reorderViewAction(input);
      if (!result.ok) toast({ type: "error", body: `Could not move ${moved.name}: ${result.message}` });
    });
  };
  const { drag, registerContainer, registerItem, registerOverlay, itemHandlers } = usePointerDrag({
    onDrop,
    itemsOf: () => ordered.map((view) => view.id),
    ignoreSelector: DRAG_IGNORE,
  });
  const dragged = drag ? ordered.find((view) => view.id === drag.id) : undefined;
  const describeButton =
    readOnly || !viewsOn || !aiAvailable ? null : (
      <Button variant="secondary" size="sm" label="Describe a view" icon={<SparkleIcon />} onClick={() => setDescribeOpen(true)} />
    );
  const newButton = readOnly ? null : <Button variant="primary" size="sm" label="New view" icon={<PlusIcon />} onClick={() => setCreateOpen(true)} />;

  // The dragged row leaves the list while it is held; a dashed slot marks where it lands.
  const rows: ReactNode[] = shown
    .filter((view) => view.id !== drag?.id)
    .map((view) => (
      <ViewRow
        key={view.id}
        projectId={projectId}
        view={view}
        count={counts[view.id] ?? 0}
        previousId={shown[shown.indexOf(view) - 1]?.id}
        nextId={shown[shown.indexOf(view) + 1]?.id}
        canReorder={canReorder}
        drag={canDrag ? { rowRef: registerItem(view.id), handlers: itemHandlers(view.id, VIEWS_CONTAINER) } : undefined}
      />
    ));
  if (drag?.target) rows.splice(Math.min(drag.target.index, rows.length), 0, <RowSlot key="slot" height={drag.height} />);

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
                  {describeButton}
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
            <List ref={registerContainer(VIEWS_CONTAINER)} density="compact" hasDividers>
              {rows}
            </List>
          )}
        </VStack>
      </PanelPage>
      {drag && dragged ? (
        <RowDragOverlay registerOverlay={registerOverlay} icon={dragged.logo ? resolveLogoIcon(dragged.logo.icon) : ViewIcon} color={dragged.logo?.color ?? "secondary"} label={dragged.name} />
      ) : null}
      <ViewDialog isOpen={isCreateOpen} onOpenChange={setCreateOpen} projectId={projectId} mode="create" title="New view" />
      <ViewFromPromptDialog isOpen={isDescribeOpen} onOpenChange={setDescribeOpen} projectId={projectId} />
    </>
  );
}
