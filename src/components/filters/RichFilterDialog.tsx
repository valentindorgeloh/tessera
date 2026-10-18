"use client";

/**
 * Advanced filter builder. One All/Any group, condition rows, and groups one
 * level deep. A tree the builder cannot show is read-only text with Clear.
 */
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { countRichConditions, RICH_FILTER_FIELD_LABELS, RICH_FILTER_OPS_BY_FIELD } from "@/lib/tessera/schemas";
import type { RichFilterField, RichFilterOp, RichFilters } from "@/lib/tessera/types";
import { TrashIcon } from "@/themes/catppuccin/icons";
import { blankCondition, fromEditable, toEditable, type EditableCondition, type EditableTree } from "./rich-filter-tree";

const FIELDS = Object.keys(RICH_FILTER_FIELD_LABELS) as RichFilterField[];

export type RichFilterDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  tree: RichFilters | null;
  onApply: (tree: RichFilters | null) => void;
};

function emptyTree(): EditableTree {
  return { match: "and", conditions: [blankCondition()], groups: [] };
}

function Row({ condition, onChange, onRemove }: { condition: EditableCondition; onChange: (next: EditableCondition) => void; onRemove: () => void }) {
  const ops = RICH_FILTER_OPS_BY_FIELD[condition.field];
  const needsValue = condition.op !== "is_null" && condition.op !== "is_not_null";
  return (
    <HStack gap={2} vAlign="end" wrap="wrap">
      <Selector
        label="Field"
        options={FIELDS.map((field) => ({ value: field, label: RICH_FILTER_FIELD_LABELS[field] }))}
        value={condition.field}
        onChange={(field) => {
          const next = field as RichFilterField;
          const nextOps = RICH_FILTER_OPS_BY_FIELD[next];
          onChange({ ...condition, field: next, op: nextOps.includes(condition.op) ? condition.op : nextOps[0] });
        }}
      />
      <Selector label="Operator" options={ops.map((op) => ({ value: op, label: op }))} value={condition.op} onChange={(op) => onChange({ ...condition, op: op as RichFilterOp })} />
      {needsValue ? <TextInput label="Value" value={condition.value} onChange={(value) => onChange({ ...condition, value })} /> : null}
      <ToggleButton label="Not" size="sm" isPressed={condition.not} onPressedChange={(not) => onChange({ ...condition, not })} />
      <IconButton label="Remove condition" icon={<Icon icon={TrashIcon} />} size="sm" variant="ghost" onClick={onRemove} />
    </HStack>
  );
}

export function RichFilterDialog({ isOpen, onOpenChange, tree, onApply }: RichFilterDialogProps) {
  const editable = tree ? toEditable(tree) : emptyTree();
  const [draft, setDraft] = useState<EditableTree | null>(editable);
  const [seen, setSeen] = useState(tree);
  if (tree !== seen) {
    setSeen(tree);
    setDraft(tree ? toEditable(tree) : emptyTree());
  }

  const apply = () => {
    onApply(draft ? fromEditable(draft) : null);
    onOpenChange(false);
  };

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={720} aria-label="Advanced filters">
      <Layout
        header={<DialogHeader title="Advanced filters" onOpenChange={onOpenChange} hasDivider />}
        content={
          <LayoutContent>
            {draft === null ? (
              <VStack gap={3}>
                <Text>This filter is more nested than the builder can edit. Clear it to start again.</Text>
                <Text type="code">{JSON.stringify(tree)}</Text>
              </VStack>
            ) : (
              <VStack gap={4}>
                <SegmentedControl label="Match" size="sm" value={draft.match} onChange={(value) => setDraft({ ...draft, match: value === "or" ? "or" : "and" })}>
                  <SegmentedControlItem value="and" label="All" />
                  <SegmentedControlItem value="or" label="Any" />
                </SegmentedControl>
                {draft.conditions.map((condition, index) => (
                  <Row
                    key={index}
                    condition={condition}
                    onChange={(next) => setDraft({ ...draft, conditions: draft.conditions.map((row, i) => (i === index ? next : row)) })}
                    onRemove={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, i) => i !== index) })}
                  />
                ))}
                {draft.groups.map((group, index) => (
                  <VStack key={index} gap={2}>
                    <SegmentedControl label="Group match" size="sm" value={group.match} onChange={(value) => setDraft({ ...draft, groups: draft.groups.map((row, i) => (i === index ? { ...row, match: value === "or" ? "or" : "and" } : row)) })}>
                      <SegmentedControlItem value="and" label="All" />
                      <SegmentedControlItem value="or" label="Any" />
                    </SegmentedControl>
                    {group.conditions.map((condition, conditionIndex) => (
                      <Row
                        key={conditionIndex}
                        condition={condition}
                        onChange={(next) =>
                          setDraft({
                            ...draft,
                            groups: draft.groups.map((row, i) => (i === index ? { ...row, conditions: row.conditions.map((item, j) => (j === conditionIndex ? next : item)) } : row)),
                          })
                        }
                        onRemove={() =>
                          setDraft({
                            ...draft,
                            groups: draft.groups.map((row, i) => (i === index ? { ...row, conditions: row.conditions.filter((_, j) => j !== conditionIndex) } : row)),
                          })
                        }
                      />
                    ))}
                    <Button variant="ghost" size="sm" label="Add condition to group" onClick={() => setDraft({ ...draft, groups: draft.groups.map((row, i) => (i === index ? { ...row, conditions: [...row.conditions, blankCondition()] } : row)) })} />
                  </VStack>
                ))}
              </VStack>
            )}
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} wrap="wrap">
              <Button variant="ghost" size="sm" label="Add condition" onClick={() => draft && setDraft({ ...draft, conditions: [...draft.conditions, blankCondition()] })} isDisabled={draft === null} />
              <Button variant="ghost" size="sm" label="Add group" onClick={() => draft && setDraft({ ...draft, groups: [...draft.groups, { match: "or", conditions: [blankCondition()] }] })} isDisabled={draft === null} />
              <Button variant="ghost" size="sm" label="Clear all" onClick={() => onApply(null)} />
              <Button variant="secondary" size="sm" label="Cancel" onClick={() => onOpenChange(false)} />
              <Button variant="primary" size="sm" label={draft ? "Apply" : "Close"} onClick={draft ? apply : () => onOpenChange(false)} />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

export function richFilterChip(tree: RichFilters | null | undefined): string | null {
  if (!tree) return null;
  const count = countRichConditions(tree);
  return `Advanced · ${count} ${count === 1 ? "condition" : "conditions"}`;
}
