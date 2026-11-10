"use client";

/**
 * Relations of a work item (decision 55, docs/contracts/ui.md "Detail components"):
 * rows grouped by display type from this item's side (blocked by / blocking,
 * relates to, duplicate of, starts before / after, finishes before / after,
 * implemented by / implements), each with the related item's state dot, key
 * (opens it), title and a remove button. "Add relation" opens a dialog:
 * pick the type, then search an item in any project (the item itself is left
 * out). Adding and removing are optimistic (decision 13: `useOptimistic` in a
 * transition, a failure reverts the row and toasts). On a read-only item
 * (archived item or project) the rows only open their item; with no relation
 * there is nothing to show then. With no relation on an editable item only the
 * heading and the Add control render.
 */
import { startTransition, useEffect, useOptimistic, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { useAnnounce } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { addRelationAction, removeRelationAction } from "@/app/actions/relations-comments";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { stateGroupVariant } from "@/components/work-items/properties";
import { PlusIcon, SearchIcon, XIcon } from "@/themes/catppuccin/icons";
import { workItemPath } from "./DetailHeader";
import {
  RELATION_CHOICES,
  RELATION_LABELS,
  applyRelationEdit,
  groupRelations,
  optimisticRelationRow,
  toRelationCandidates,
  type RelationCandidate,
  type RelationDisplayType,
  type RelationRowView,
} from "./relation-model";
import { useActionRunner } from "./use-detail-actions";
import { useWorkItemSearch } from "./use-work-item-search";

export type RelationsListProps = {
  workItemId: string;
  /** The open item's project: a related item of another project opens its full page. */
  projectId: string;
  relations: readonly RelationRowView[];
  /** Archived item or project: rows open their item, nothing changes. */
  readOnly?: boolean;
  onOpenItem: (id: string) => void;
};

type PickerProps = {
  excludeId: string;
  onPick: (type: RelationDisplayType, hit: RelationCandidate) => void;
  onOpenChange: (isOpen: boolean) => void;
};

/** The dialog body: type first, then the search. Mounted only while open, so each session starts clean. */
function RelationPicker({ excludeId, onPick, onOpenChange }: PickerProps) {
  const [type, setType] = useState<RelationDisplayType>("relates_to");
  const [query, setQuery] = useState("");
  const search = useWorkItemSearch(query, null, true, toRelationCandidates);
  const isEmptyQuery = query.trim() === "";
  const hits = isEmptyQuery ? [] : search.hits.filter((hit) => hit.id !== excludeId);
  let status: string | null = null;
  if (isEmptyQuery) status = "Type a key or a title.";
  else if (search.status === "unavailable") status = "Search is not available yet.";
  else if (search.status !== "ready" && hits.length === 0) status = "Searching…";
  else if (hits.length === 0) status = "No matching work items.";
  return (
    <Layout
      header={<DialogHeader title="Add relation" onOpenChange={onOpenChange} />}
      content={
        <LayoutContent>
          <FormLayout>
            <Selector
              label="Relation type"
              options={RELATION_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))}
              value={type}
              onChange={(next) => setType(RELATION_CHOICES.find((choice) => choice.value === next)?.value ?? type)}
            />
            <VStack gap={2}>
              <TextInput label="Work item" value={query} onChange={setQuery} placeholder="Key or title" startIcon={SearchIcon} hasAutoFocus />
              {hits.length > 0 ? (
                <List density="compact" aria-label="Matching work items" className="tessera-relation-hits">
                  {hits.map((hit) => (
                    // The key belongs to the accessible name (decision 55: items are matched and shown by key and title); startContent sits outside the item's button.
                    <ListItem key={hit.id} label={hit.key ? `${hit.key} ${hit.title}` : hit.title} description={hit.subtitle ?? undefined} onClick={() => onPick(type, hit)} />
                  ))}
                </List>
              ) : null}
              {status ? (
                <Text type="supporting" color="secondary" aria-live="polite">
                  {status}
                </Text>
              ) : null}
            </VStack>
          </FormLayout>
        </LayoutContent>
      }
    />
  );
}

type RowProps = {
  row: RelationRowView;
  projectId: string;
  readOnly: boolean;
  onOpenItem: (id: string) => void;
  onRemove: (row: RelationRowView) => void;
};

function RelationRow({ row, projectId, readOnly, onOpenItem, onRemove }: RowProps) {
  const { item } = row;
  const opensHere = item.project_id === projectId;
  return (
    <HStack gap={2} vAlign="center" className="tessera-detail-row tessera-relation-row" as="li">
      {item.state ? <StatusDot variant={stateGroupVariant(item.state.state_group)} label={item.state.name} /> : <StatusDot variant="neutral" label="State" />}
      {/* A related item of another project is not in this project's peek: its key links to the full page. */}
      <Button
        className="tessera-detail-key"
        variant="ghost"
        size="sm"
        label={item.key}
        {...(opensHere ? { onClick: () => onOpenItem(item.id) } : { href: workItemPath(item) })}
      />
      <Text type="body" className="tessera-detail-row-name tessera-detail-row-name--clamp" maxLines={1}>
        {item.name}
      </Text>
      <HStack gap={1} vAlign="center" className="tessera-detail-row-props">
        {item.archived ? (
          <Text type="supporting" color="secondary">
            Archived
          </Text>
        ) : null}
        {readOnly ? null : (
          <IconButton variant="ghost" size="sm" label={`Remove relation to ${item.key}`} icon={<Icon icon={XIcon} size="sm" />} onClick={() => onRemove(row)} className="tessera-hit tessera-hit-x" />
        )}
      </HStack>
    </HStack>
  );
}

export function RelationsList({ workItemId, projectId, relations, readOnly = false, onOpenItem }: RelationsListProps) {
  const { fail } = useActionRunner();
  const announce = useAnnounce();
  const [rows, applyEdit] = useOptimistic(relations, applyRelationEdit);
  const [adding, setAdding] = useState(false);
  // Focus returns to Add relation when the dialog closes (a pick, Esc or the close button) and after a row is removed:
  // the dialog's own restore ran against a button the optimistic render could replace, and a removed row's button is gone.
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const wasAdding = useRef(false);
  useEffect(() => {
    if (wasAdding.current && !adding) addButtonRef.current?.focus();
    wasAdding.current = adding;
  }, [adding]);

  const add = (type: RelationDisplayType, hit: RelationCandidate) => {
    setAdding(false);
    startTransition(async () => {
      applyEdit({ kind: "add", row: optimisticRelationRow(type, hit, projectId) });
      const result = await addRelationAction({ work_item_id: workItemId, related_work_item_id: hit.id, relation_type: type });
      // The dialog has closed and focus is back on Add relation: the new row is told once the engine has taken it (fail() toasts a refusal, and the toast speaks itself).
      if (result.ok) announce(`Added relation: ${RELATION_LABELS[type]} ${hit.key || hit.title}`);
      else fail(`Could not add the relation: ${result.message}`);
    });
  };

  const remove = (row: RelationRowView) => {
    addButtonRef.current?.focus();
    startTransition(async () => {
      applyEdit({ kind: "remove", id: row.id });
      const result = await removeRelationAction({ work_item_id: workItemId, related_work_item_id: row.item.id });
      if (result.ok) announce(`Removed relation to ${row.item.key}`);
      else fail(`Could not remove the relation: ${result.message}`);
    });
  };

  if (readOnly && rows.length === 0) return null;
  const groups = groupRelations(rows);
  return (
    <VStack gap={2} className="tessera-detail-relations">
      <HStack gap={2} vAlign="center" hAlign="between">
        <Text type="label" color="secondary">
          Relations{rows.length > 0 ? ` (${rows.length})` : ""}
        </Text>
        {readOnly ? null : <Button ref={addButtonRef} variant="ghost" size="sm" icon={<PlusIcon />} label="Add relation" onClick={() => setAdding(true)} />}
      </HStack>
      {groups.map((group) => (
        <VStack gap={0} key={group.type}>
          <Text type="supporting" color="secondary" weight="medium">
            {group.label}
          </Text>
          <VStack gap={0} as="ul" aria-label={group.label}>
            {group.rows.map((row) => (
              <RelationRow key={row.id} row={row} projectId={projectId} readOnly={readOnly} onOpenItem={onOpenItem} onRemove={remove} />
            ))}
          </VStack>
        </VStack>
      ))}
      {readOnly ? null : (
        // Named explicitly: the Dialog reads its DialogHeader title only when the <dialog> attaches, and the picker mounts later.
        <Dialog isOpen={adding} onOpenChange={setAdding} purpose="form" width={480} aria-label="Add relation">
          {adding ? <RelationPicker excludeId={workItemId} onPick={add} onOpenChange={setAdding} /> : null}
        </Dialog>
      )}
    </VStack>
  );
}
