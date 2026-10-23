"use client";

/**
 * Stickies at `/stickies` (docs/drafts/p9-plan.md U1). Search writes `?q=`
 * after a short pause. New notes are created first and the page scrolls to them.
 */
import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { createStickyAction, moveStickyAction } from "@/app/actions/stickies";
import { usePointerDrag, type DragDropEvent } from "@/components/dnd/use-pointer-drag";
import { entityId, stickyColorClass, stickyPreview, stickyTitle, type StickyView } from "@/components/home/home-format";
import { PanelBar, PanelHeader, PanelPage, PanelTitle } from "@/components/shell/PanelHeader";
import "@/components/styles/stickies.css";
import { DraftIcon, PlusIcon, SearchIcon } from "@/themes/catppuccin/icons";
import { placementFor, reorderBy, scrollParentOf, stepIndex } from "./reorder-math";
import { StickyCard } from "./StickyCard";

export type StickiesScreenProps = {
  stickies: StickyView[];
  q: string;
};

/** Grid's minWidth is a pixel count. 256 is the reference card's minimum (Stickies grid), 4 or 5 columns at the 1170px content width. */
const STICKY_COLUMN_MIN = 256;
const SEARCH_DELAY_MS = 300;
const GRID_CONTAINER = "stickies";
/** The grip is the only drag source; everything that edits keeps its own press. */
const DRAG_IGNORE = 'input, textarea, select, a, [contenteditable="true"], [role="menu"], [role="menuitem"], [role="dialog"], [role="listbox"]';

export function StickiesScreen({ stickies, q }: StickiesScreenProps) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState(q);
  const wrote = useRef(q);
  const [isCreating, startCreate] = useTransition();
  // Decision 105: the grid reorders by pointer drag; the card menu keeps Move earlier / Move later (decision 14).
  const [shown, applyMove] = useOptimistic(stickies, (current, move: { id: string; index: number }) => reorderBy(current, (sticky) => sticky.id, move.id, move.index));
  const [, startMove] = useTransition();
  const ids = shown.map((sticky) => sticky.id);

  const moveTo = (id: string, index: number) => {
    const placement = placementFor(ids, id, index);
    if (placement === null) return;
    startMove(async () => {
      applyMove({ id, index });
      const result = await moveStickyAction({ sticky_id: id, ...placement });
      if (!result.ok) toast({ type: "error", body: `Could not move the sticky. ${result.message}` });
    });
  };

  const { drag, registerContainer, registerItem, registerScroller, registerOverlay, itemHandlers } = usePointerDrag({
    onDrop: (event: DragDropEvent) => moveTo(event.id, event.index),
    itemsOf: () => ids,
    axis: "grid",
    ignoreSelector: DRAG_IGNORE,
  });
  const gridRef = useCallback(
    (element: HTMLElement | null) => {
      registerContainer(GRID_CONTAINER)(element);
      registerScroller(scrollParentOf(element));
    },
    [registerContainer, registerScroller],
  );
  const dragged = drag === null ? undefined : shown.find((sticky) => sticky.id === drag.id);

  useEffect(() => {
    if (q === wrote.current) return;
    wrote.current = q;
    setDraft(q);
  }, [q]);

  useEffect(() => {
    const next = draft.trim();
    if (next === q) return;
    const handle = window.setTimeout(() => {
      wrote.current = next;
      router.replace(next === "" ? "/stickies" : `/stickies?${new URLSearchParams({ q: next }).toString()}`, { scroll: false });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [draft, q, router]);

  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (id === "") return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [stickies]);

  const create = () => {
    if (isCreating) return;
    startCreate(async () => {
      const result = await createStickyAction({});
      if (!result.ok) {
        toast({ type: "error", body: `Could not create the sticky. ${result.message}` });
        return;
      }
      const id = entityId(result.data);
      if (id !== null) router.push(`/stickies#${id}`);
    });
  };

  // The landing slot is a dashed placeholder among the items that stay; the dragged card is hidden in place (kept mounted, so an unsaved edit survives).
  const nodes: ReactNode[] = [];
  const target = drag?.target ?? null;
  let stayIndex = 0;
  let placed = false;
  const placeholder = drag === null ? null : <Card key="placeholder" variant="muted" padding={0} height={drag.height} className="tessera-board-placeholder" />;
  for (const sticky of shown) {
    const isDragged = drag?.id === sticky.id;
    if (!isDragged && !placed && target !== null && stayIndex === target.index) {
      nodes.push(placeholder);
      placed = true;
    }
    nodes.push(
      <StickyCard
        key={sticky.id}
        sticky={sticky}
        registerItem={registerItem(sticky.id)}
        handlers={itemHandlers(sticky.id, GRID_CONTAINER)}
        isDragged={isDragged}
        canMoveEarlier={stepIndex(ids, sticky.id, -1) !== null}
        canMoveLater={stepIndex(ids, sticky.id, 1) !== null}
        onStep={(direction) => {
          const to = stepIndex(ids, sticky.id, direction);
          if (to !== null) moveTo(sticky.id, to);
        }}
      />,
    );
    if (!isDragged) stayIndex++;
  }
  if (target !== null && !placed) nodes.push(placeholder);

  const searching = q.trim() !== "";
  return (
    <PanelPage
      header={
        <PanelHeader label="Stickies">
          <PanelBar
            canWrap
            start={<PanelTitle>Stickies</PanelTitle>}
            end={
              <HStack gap={2} vAlign="center" wrap="wrap">
                <TextInput
                  label="Search stickies"
                  isLabelHidden
                  size="sm"
                  value={draft}
                  onChange={setDraft}
                  placeholder="Search notes"
                  startIcon={SearchIcon}
                  hasClear
                  className="tessera-stickies-search"
                />
                <Button variant="primary" size="sm" label="New sticky" icon={<PlusIcon />} onClick={create} isLoading={isCreating} />
              </HStack>
            }
          />
        </PanelHeader>
      }
    >
      <VStack gap={4} padding={4}>
        {shown.length === 0 ? (
          <EmptyState
            icon={<Icon icon={DraftIcon} size="lg" color="secondary" />}
            title={searching ? "No matching stickies" : "No stickies yet"}
            description={searching ? "Try a different search." : "Notes live on the workspace, outside any project."}
            actions={searching ? undefined : <Button variant="primary" label="New sticky" icon={<PlusIcon />} onClick={create} isLoading={isCreating} />}
          />
        ) : (
          <Grid ref={gridRef} className="tessera-sticky-grid tessera-stickies-board" columns={{ minWidth: STICKY_COLUMN_MIN, repeat: "fit" }} gap={4}>
            {nodes}
          </Grid>
        )}
        {drag && dragged ? (
          <Card ref={registerOverlay} padding={3} elevation="high" className={`tessera-drag-overlay ${stickyColorClass(dragged.color)}`} aria-hidden="true">
            <VStack gap={1}>
              <Text weight="medium" maxLines={1}>
                {stickyTitle(dragged.name)}
              </Text>
              <Text type="supporting" color="secondary" maxLines={3}>
                {stickyPreview(dragged.description_md)}
              </Text>
            </VStack>
          </Card>
        ) : null}
      </VStack>
    </PanelPage>
  );
}
