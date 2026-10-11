"use client";

/**
 * Sub-items of a work item (docs/contracts/ui.md "SubItems"): one row per
 * child with its key (opens it), name, compact state and assignee controls
 * and a row menu with "Move up", "Move down" and "Remove from parent". Alt
 * with the up or down arrow reorders the focused row. "Add sub-item" is an
 * inline input that creates a child in the same project. On an archived
 * parent (`readOnly`) the rows only open their item: no add, no reorder, no
 * property or menu writes (the engine would answer ARCHIVED).
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@astryxdesign/core/Button";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { createWorkItemAction, moveWorkItemAction, setAssigneesAction, updateWorkItemAction } from "@/app/actions/work-items";
import { AssigneeControl, StateControl } from "@/components/work-items/properties";
import type { WorkItem } from "@/lib/tessera/types";
import { PlusIcon } from "@/themes/paper/icons";
import { sameIds } from "./patch";
import { useActionRunner, type ActionRunner } from "./use-detail-actions";

export type SubItemsProps = {
  parent: WorkItem;
  children: WorkItem[];
  /** Archived parent: rows open their item, nothing else. */
  readOnly?: boolean;
  onOpenItem: (id: string) => void;
};

type RowProps = {
  item: WorkItem;
  isFirst: boolean;
  isLast: boolean;
  readOnly: boolean;
  run: ActionRunner;
  onOpenItem: (id: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
};

function SubItemRow({ item, isFirst, isLast, readOnly, run, onOpenItem, onMoveUp, onMoveDown }: RowProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (readOnly || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    if (event.key === "ArrowUp" && !isFirst) onMoveUp();
    if (event.key === "ArrowDown" && !isLast) onMoveDown();
  };
  return (
    <HStack gap={2} vAlign="center" className="tessera-detail-row" as="li" onKeyDown={onKeyDown}>
      <Button className="tessera-detail-key" variant="ghost" size="sm" label={item.key} onClick={() => onOpenItem(item.id)} />
      <Text type="body" className="tessera-detail-row-name" maxLines={1}>
        {item.name}
      </Text>
      <HStack gap={1} vAlign="center" className="tessera-detail-row-props">
        <StateControl
          compact
          readOnly={readOnly}
          value={item.state_id}
          onChange={(state_id) => {
            if (state_id !== item.state_id) run(() => updateWorkItemAction({ work_item_id: item.id, state_id }));
          }}
        />
        <AssigneeControl
          compact
          readOnly={readOnly}
          value={item.assignee_ids}
          onChange={(actor_ids) => {
            if (!sameIds(actor_ids, item.assignee_ids)) run(() => setAssigneesAction({ work_item_id: item.id, actor_ids }));
          }}
        />
        {readOnly ? null : (
          <MoreMenu
            label={`Options for ${item.key}`}
            size="sm"
            items={[
              { id: "up", label: "Move up", isDisabled: isFirst, onClick: onMoveUp },
              { id: "down", label: "Move down", isDisabled: isLast, onClick: onMoveDown },
              { type: "divider" },
              {
                id: "detach",
                label: "Remove from parent",
                onClick: () => run(() => updateWorkItemAction({ work_item_id: item.id, parent_id: null }), undefined, "Could not remove the sub-item"),
              },
            ]}
          />
        )}
      </HStack>
    </HStack>
  );
}

function AddSubItem({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [isActive, setActive] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isActive) inputRef.current?.focus();
  }, [isActive]);

  if (!isActive) {
    return (
      <HStack>
        <Button variant="ghost" size="sm" icon={<PlusIcon />} label="Add sub-item" onClick={() => setActive(true)} />
      </HStack>
    );
  }
  const submit = () => {
    const trimmed = name.trim();
    if (trimmed === "") {
      setActive(false);
      return;
    }
    onSubmit(trimmed);
    setName("");
  };
  return (
    <HStack gap={2} vAlign="center" className="tessera-detail-row">
      <TextInput
        ref={inputRef}
        label="New sub-item"
        isLabelHidden
        size="sm"
        value={name}
        onChange={setName}
        onEnter={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setName("");
            setActive(false);
          }
        }}
        onBlur={() => {
          if (name.trim() === "") setActive(false);
        }}
        placeholder="Sub-item name, then Enter"
        width="fill"
      />
    </HStack>
  );
}

export function SubItems({ parent, children, readOnly = false, onOpenItem }: SubItemsProps) {
  const { run } = useActionRunner();

  // Sequence order: moving up places the item before its previous sibling (which then comes after it), and the reverse for down.
  const moveUp = (index: number) => {
    const previous = children[index - 1];
    if (!previous) return;
    run(() => moveWorkItemAction({ work_item_id: children[index].id, after_id: previous.id }), undefined, "Could not move the sub-item");
  };
  const moveDown = (index: number) => {
    const next = children[index + 1];
    if (!next) return;
    run(() => moveWorkItemAction({ work_item_id: children[index].id, before_id: next.id }), undefined, "Could not move the sub-item");
  };

  const add = (name: string) => {
    run(() => createWorkItemAction({ project_id: parent.project_id, name, parent_id: parent.id, source: "in_app" }), undefined, "Could not create the sub-item");
  };

  return (
    <VStack gap={2} className="tessera-detail-subitems">
      <Text type="label" color="secondary">
        Sub-items{children.length > 0 ? ` (${children.length})` : ""}
      </Text>
      {children.length > 0 ? (
        <VStack gap={0} as="ul" aria-label="Sub-items">
          {children.map((child, index) => (
            <SubItemRow
              key={child.id}
              item={child}
              isFirst={index === 0}
              isLast={index === children.length - 1}
              readOnly={readOnly}
              run={run}
              onOpenItem={onOpenItem}
              onMoveUp={() => moveUp(index)}
              onMoveDown={() => moveDown(index)}
            />
          ))}
        </VStack>
      ) : null}
      {readOnly ? null : <AddSubItem onSubmit={add} />}
    </VStack>
  );
}
