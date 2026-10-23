"use client";

/**
 * Archives › Work items (docs/contracts/ui.md "Archives (E3)"): one row per
 * archived work item, last updated first. A row opens the peek (the list's
 * `onOpen` body: `peekHref` + `notePeekPush`); its end holds Restore and a
 * menu with Delete…. Rendered inside `PeekHost` by the archives page, so the
 * peek shows the archived Banner next to the list.
 */
import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertDialog } from "@/components/shell/dialogs";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { List, ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { useToast } from "@astryxdesign/core/Toast";
import { deleteWorkItemAction, unarchiveWorkItemAction } from "@/app/actions/work-items";
import { notePeekPush } from "@/components/detail/peek-history";
import { currentHref, peekHref, peekIdOf } from "@/components/detail/peek-url";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { forgetRecentsUnder } from "@/components/shell/recents-store";
import { BulkBar } from "@/components/work-items/BulkBar";
import { FilterBar } from "@/components/work-items/FilterBar";
import { stateGroupVariant } from "@/components/work-items/properties";
import { useProject } from "@/components/work-items/project-provider";
import { useSelection } from "@/components/work-items/use-selection";
import type { UrlState } from "@/components/work-items/types";
import type { Filters, WorkItem } from "@/lib/tessera/types";
import { ArchiveIcon, RestoreIcon, TrashIcon } from "@/themes/catppuccin/icons";
import { failureText } from "./archive-rules";

export type ArchivedWorkItemsProps = { projectId: string; items: WorkItem[]; filters: Filters; urlState: UrlState };

export function ArchivedWorkItems({ items, filters, urlState }: ArchivedWorkItemsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [deleting, setDeleting] = useState<WorkItem | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const selection = useSelection(
    items.map((item) => item.id),
    true,
  );
  const filtered = Object.keys(filters).length > 0;

  const open = (id: string) => {
    const href = peekHref(pathname, searchParams, id);
    notePeekPush(currentHref(pathname, searchParams), href);
    router.push(href, { scroll: false });
  };

  const confirmDelete = () => {
    const item = deleting;
    if (item === null) return;
    startDelete(async () => {
      const result = await deleteWorkItemAction({ work_item_id: item.id });
      if (!result.ok) {
        toast({ type: "error", body: failureText(`Could not delete ${item.key}`, result.message) });
        return;
      }
      setDeleting(null);
      toast({ type: "info", body: `Deleted ${item.key}` });
      // Like the detail's Delete: both routes of the item leave the recents.
      forgetRecentsUnder(`/projects/${item.project_id}/work-items/${item.id}`);
      forgetRecentsUnder(`/work-items/${item.id}`);
      // The peek of a deleted item would only show "not found": close it with the row.
      if (peekIdOf(searchParams) === item.id) router.replace(peekHref(pathname, searchParams, null), { scroll: false });
    });
  };

  // The list is inset 8px and a row's text 8px more (Astryx's item inset), on the panel header's 16px. The extra end
  // padding lets the last row's menu scroll clear of the bottom-end toasts and the dev indicator.
  return (
    <VStack
      gap={0}
      paddingInline={2}
      paddingBlockStart={2}
      paddingBlockEnd={10}
      className={selection.selected.size > 0 ? "tessera-archives-list tessera-wi-list--selecting" : "tessera-archives-list"}
    >
      <FilterBar filters={filters} urlState={urlState} resultCount={items.length} />
      {items.length === 0 ? (
        <EmptyState
          icon={<ArchiveIcon />}
          title="No archived work items"
          description={
            filtered
              ? "No archived work items match these filters."
              : "Completed or cancelled work items you archive are kept here, read-only, until you restore them."
          }
        />
      ) : (
        <List hasDividers aria-label="Archived work items">
          {items.map((item) => (
            <ArchivedWorkItemRow
              key={item.id}
              item={item}
              selected={selection.selected.has(item.id)}
              onToggle={(shift) => selection.toggleId(item.id, shift)}
              onOpen={open}
              onDelete={setDeleting}
            />
          ))}
        </List>
      )}
      {selection.selected.size > 0 ? <BulkBar variant="archived" items={items} selected={selection.selected} onClear={selection.clear} /> : null}
      <AlertDialog
        isOpen={deleting !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isDeleting) setDeleting(null);
        }}
        title={`Delete ${deleting?.key ?? "work item"}?`}
        description="This cannot be undone."
        actionLabel="Delete"
        actionVariant="destructive"
        isActionLoading={isDeleting}
        onAction={confirmDelete}
      />
    </VStack>
  );
}

type RowProps = {
  item: WorkItem;
  selected: boolean;
  onToggle: (shift: boolean) => void;
  onOpen: (id: string) => void;
  onDelete: (item: WorkItem) => void;
};

function ArchivedWorkItemRow({ item, selected, onToggle, onOpen, onDelete }: RowProps) {
  const { statesById } = useProject();
  const toast = useToast();
  const [isRestoring, startRestore] = useTransition();
  const state = statesById.get(item.state_id);

  const restore = () => {
    startRestore(async () => {
      const result = await unarchiveWorkItemAction({ work_item_id: item.id });
      if (result.ok) toast({ type: "info", body: `Restored ${item.key}` });
      else toast({ type: "error", body: failureText(`Could not restore ${item.key}`, result.message) });
    });
  };

  return (
    <ListItem
      className="tessera-wi-row tessera-row-hit"
      label={`${item.key} ${item.name}`}
      description={
        // No hover card: the time sits inside the row's link or button, which holds no second control or tab stop.
        item.archived_at === null ? undefined : (
          <>
            Archived <RelativeTime value={item.archived_at} hasTooltip={false} />
          </>
        )
      }
      onClick={() => onOpen(item.id)}
      startContent={
        <HStack gap={2} vAlign="center" onClick={(event) => event.stopPropagation()}>
          <CheckboxInput
            className="tessera-wi-select"
            size="sm"
            isLabelHidden
            label={`Select ${item.key}`}
            value={selected}
            onChange={(_checked, event) => onToggle("shiftKey" in event.nativeEvent && event.nativeEvent.shiftKey === true)}
          />
          {state ? <StatusDot variant={stateGroupVariant(state.state_group)} label={state.name} /> : <StatusDot variant="neutral" label="Removed" />}
        </HStack>
      }
      endContent={
        // The row opens the peek on a click anywhere outside a button; the menu's items are not buttons, so their clicks stop here.
        <HStack gap={1} vAlign="center" onClick={(event) => event.stopPropagation()}>
          <Button variant="secondary" size="sm" label="Restore" icon={<RestoreIcon />} isLoading={isRestoring} onClick={restore} />
          <MoreMenu
            label="Work item actions"
            size="sm"
            alignment="end"
            items={[{ id: "delete", label: "Delete…", icon: TrashIcon, variant: "destructive", onClick: () => onDelete(item) }]}
          />
        </HStack>
      }
    />
  );
}
