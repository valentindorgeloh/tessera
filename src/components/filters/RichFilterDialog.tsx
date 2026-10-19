"use client";

/**
 * Advanced filter builder (decision 93). One All/Any group, condition rows, and groups one
 * level deep. A tree the builder cannot show is read-only text with Clear.
 */
import { useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { MultiSelector } from "@astryxdesign/core/MultiSelector";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { Dialog, DialogHeader } from "@/components/shell/dialogs";
import { useOptionalProject } from "@/components/work-items/project-provider";
import { countRichConditions, RICH_FILTER_FIELD_LABELS, RICH_FILTER_OPS_BY_FIELD } from "@/lib/tessera/schemas";
import type { RichFilterField, RichFilterOp, RichFilters } from "@/lib/tessera/types";
import { TrashIcon } from "@/themes/catppuccin/icons";
import {
  buildFilterLookup,
  describeRichFilters,
  fieldLabel,
  operatorLabel,
  RELATIVE_LABELS,
  withSelected,
  type FilterLookup,
} from "./rich-filter-labels";
import {
  blankCondition,
  defaultValue,
  editableConditionCount,
  fromEditable,
  isDateField,
  isListOp,
  isRelativeToken,
  MAX_CONDITIONS,
  opTakesValue,
  toEditable,
  treeIsComplete,
  valueForOp,
  type EditableCondition,
  type EditableTree,
  type RelativeToken,
} from "./rich-filter-tree";

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

function ValueInput({
  condition,
  lookup,
  onChange,
}: {
  condition: EditableCondition;
  lookup: FilterLookup;
  onChange: (value: string[]) => void;
}) {
  if (!opTakesValue(condition.op)) return null;

  if (condition.field === "blocked") {
    return (
      <Selector
        label="Value"
        options={[
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ]}
        value={condition.value[0] ?? "true"}
        onChange={(value) => onChange([value])}
      />
    );
  }

  if (isDateField(condition.field)) {
    if (condition.op === "between") {
      return (
        <HStack gap={2} vAlign="end">
          <TextInput
            label="From"
            placeholder="YYYY-MM-DD"
            value={condition.value[0] ?? ""}
            onChange={(from) => onChange([from, condition.value[1] ?? ""])}
          />
          <TextInput
            label="To"
            placeholder="YYYY-MM-DD"
            value={condition.value[1] ?? ""}
            onChange={(to) => onChange([condition.value[0] ?? "", to])}
          />
        </HStack>
      );
    }
    const relativeOptions = (Object.keys(RELATIVE_LABELS) as RelativeToken[]).map((token) => ({
      value: token,
      label: RELATIVE_LABELS[token],
    }));
    const dateOptions = [...relativeOptions, { value: "exact", label: "Exact date…" }];
    const isRel = isRelativeToken(condition.value[0]);
    return (
      <HStack gap={2} vAlign="end">
        <Selector
          label="Value"
          options={dateOptions}
          value={isRel ? (condition.value[0] as string) : "exact"}
          onChange={(token) => {
            if (token === "exact") onChange([lookup.today || ""]);
            else onChange([token]);
          }}
        />
        {!isRel ? (
          <TextInput
            label="Date"
            placeholder="YYYY-MM-DD"
            value={condition.value[0] ?? ""}
            onChange={(val) => onChange([val])}
          />
        ) : null}
      </HStack>
    );
  }

  const options = lookup.options[condition.field];
  if (options && options.length > 0) {
    const effectiveOptions = withSelected(options, condition.value);
    if (isListOp(condition.op)) {
      return (
        <MultiSelector
          label="Value"
          options={effectiveOptions}
          value={condition.value}
          onChange={onChange}
          size="sm"
        />
      );
    }
    return (
      <Selector
        label="Value"
        options={effectiveOptions}
        value={condition.value[0] ?? effectiveOptions[0]?.value ?? ""}
        onChange={(val) => onChange([val])}
      />
    );
  }

  return (
    <TextInput
      label="Value"
      value={condition.value[0] ?? ""}
      onChange={(value) => onChange([value])}
    />
  );
}

function Row({
  condition,
  lookup,
  onChange,
  onRemove,
}: {
  condition: EditableCondition;
  lookup: FilterLookup;
  onChange: (next: EditableCondition) => void;
  onRemove: () => void;
}) {
  const ops = RICH_FILTER_OPS_BY_FIELD[condition.field];
  return (
    <HStack gap={2} vAlign="end" wrap="wrap">
      <Selector
        label="Field"
        options={FIELDS.map((field) => ({ value: field, label: fieldLabel(field) }))}
        value={condition.field}
        onChange={(field) => {
          const nextField = field as RichFilterField;
          const nextOps = RICH_FILTER_OPS_BY_FIELD[nextField];
          const nextOp = nextOps.includes(condition.op) ? condition.op : nextOps[0];
          const firstOption = lookup.options[nextField]?.[0]?.value;
          onChange({
            field: nextField,
            op: nextOp,
            value: defaultValue(nextField, nextOp, firstOption, lookup.today),
            not: condition.not,
          });
        }}
      />
      <Selector
        label="Operator"
        options={ops.map((op) => ({ value: op, label: operatorLabel(condition.field, op) }))}
        value={condition.op}
        onChange={(op) => {
          const nextOp = op as RichFilterOp;
          onChange({ ...condition, op: nextOp, value: valueForOp(condition, nextOp) });
        }}
      />
      <ValueInput condition={condition} lookup={lookup} onChange={(value) => onChange({ ...condition, value })} />
      <ToggleButton label="Not" size="sm" isPressed={condition.not} onPressedChange={(not) => onChange({ ...condition, not })} />
      <IconButton label="Remove condition" icon={<Icon icon={TrashIcon} />} size="sm" variant="ghost" onClick={onRemove} />
    </HStack>
  );
}

export function RichFilterDialog({ isOpen, onOpenChange, tree, onApply }: RichFilterDialogProps) {
  const project = useOptionalProject();
  const lookup = useMemo(() => buildFilterLookup(project?.bundle ?? null), [project?.bundle]);
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

  const count = draft ? editableConditionCount(draft) : 0;
  const atLimit = count >= MAX_CONDITIONS;
  const isComplete = draft ? treeIsComplete(draft) : true;

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={720} aria-label="Advanced filters">
      <Layout
        header={<DialogHeader title="Advanced filters" onOpenChange={onOpenChange} hasDivider />}
        content={
          <LayoutContent>
            {draft === null ? (
              <VStack gap={3}>
                <Text>This filter is more nested than the builder can edit. Clear it to start again.</Text>
                {tree ? <Text color="secondary">{describeRichFilters(tree, lookup)}</Text> : null}
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
                    lookup={lookup}
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
                        lookup={lookup}
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
                    <Button variant="ghost" size="sm" label="Add condition to group" isDisabled={atLimit} onClick={() => setDraft({ ...draft, groups: draft.groups.map((row, i) => (i === index ? { ...row, conditions: [...row.conditions, blankCondition()] } : row)) })} />
                  </VStack>
                ))}
              </VStack>
            )}
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} wrap="wrap">
              <Button variant="ghost" size="sm" label="Add condition" onClick={() => draft && setDraft({ ...draft, conditions: [...draft.conditions, blankCondition()] })} isDisabled={draft === null || atLimit} />
              <Button variant="ghost" size="sm" label="Add group" onClick={() => draft && setDraft({ ...draft, groups: [...draft.groups, { match: "or", conditions: [blankCondition()] }] })} isDisabled={draft === null || atLimit} />
              <Button variant="ghost" size="sm" label="Clear all" onClick={() => onApply(null)} />
              <Button variant="secondary" size="sm" label="Cancel" onClick={() => onOpenChange(false)} />
              <Button variant="primary" size="sm" label={draft ? "Apply" : "Close"} isDisabled={draft !== null && !isComplete} onClick={draft ? apply : () => onOpenChange(false)} />
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
