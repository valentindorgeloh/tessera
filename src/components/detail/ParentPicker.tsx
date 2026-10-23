"use client";

/**
 * Parent picker (docs/contracts/ui.md "ParentPicker"): a ghost selector-style
 * trigger showing the parent's key and name; its menu searches the project's
 * work items through `GET /api/search` (lane D4's route) and excludes the item
 * itself and its direct sub-items. The engine rejects deeper cycles with
 * RULE, which the caller shows as a toast.
 */
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { ComplexSelector } from "@astryxdesign/core/ComplexSelector";
import { List, ListItem } from "@astryxdesign/core/List";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { SearchIcon } from "@/themes/catppuccin/icons";
import { parentTriggerLabel, toCandidates, type WorkItemCandidate } from "./search-hits";
import { searchUrl, useWorkItemSearch } from "./use-work-item-search";

export type ParentPickerProps = {
  /** Parent id or null. */
  value: string | null;
  onChange: (id: string | null) => void;
  projectId: string;
  /** The item being edited: never offered as its own parent. */
  excludeId: string;
  /** Direct sub-items of the item: never offered either (the engine guards the rest of the tree). */
  excludeIds?: readonly string[];
  /** The current parent as loaded, for the trigger (used while its id equals `value`). */
  parent?: { id: string; key: string; name: string } | null;
  compact?: boolean;
  readOnly?: boolean;
};

/** A work item hit as the picker shows it. */
export type ParentCandidate = WorkItemCandidate;

export { searchUrl };

type MenuProps = {
  value: string | null;
  projectId: string;
  exclude: ReadonlySet<string>;
  isOpen: boolean;
  onPick: (hit: ParentCandidate | null) => void;
};

function ParentMenu({ value, projectId, exclude, isOpen, onPick }: MenuProps) {
  const [query, setQuery] = useState("");
  const search = useWorkItemSearch(query, projectId, isOpen, toCandidates);
  const isEmptyQuery = query.trim() === "";
  const hits = isEmptyQuery ? [] : search.hits.filter((hit) => !exclude.has(hit.id));
  let status: string | null = null;
  if (isEmptyQuery) status = "Type a key or a title.";
  else if (search.status === "unavailable") status = "Search is not available yet.";
  else if (search.status !== "ready" && hits.length === 0) status = "Searching…";
  else if (hits.length === 0) status = "No matching work items.";
  return (
    <VStack gap={2} padding={2} className="tessera-detail-parent-menu">
      <TextInput label="Search work items" isLabelHidden size="sm" value={query} onChange={setQuery} placeholder="Key or title" startIcon={SearchIcon} hasAutoFocus />
      {value !== null ? <Button variant="ghost" size="sm" label="Remove parent" onClick={() => onPick(null)} /> : null}
      {hits.length > 0 ? (
        <List density="compact" aria-label="Matching work items">
          {hits.map((hit) => (
            <ListItem
              key={hit.id}
              label={hit.title}
              isSelected={hit.id === value}
              startContent={
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  {hit.key}
                </Text>
              }
              onClick={() => onPick(hit)}
            />
          ))}
        </List>
      ) : null}
      {status ? (
        <Text type="supporting" color="secondary" aria-live="polite">
          {status}
        </Text>
      ) : null}
    </VStack>
  );
}

export function ParentPicker({ value, onChange, projectId, excludeId, excludeIds = [], parent = null, compact = false, readOnly = false }: ParentPickerProps) {
  const [isOpen, setOpen] = useState(false);
  const [picked, setPicked] = useState<ParentCandidate | null>(null);
  const exclude = new Set<string>([excludeId, ...excludeIds]);
  return (
    <ComplexSelector<string | null>
      label="Parent"
      isLabelHidden
      variant="ghost"
      size={compact ? "sm" : "md"}
      value={value}
      onChange={(next) => {
        if (next !== value) onChange(next);
      }}
      triggerLabel={parentTriggerLabel(value, parent, picked)}
      placeholder="No parent"
      isDisabled={readOnly}
      onOpenChange={setOpen}
      placement="below"
    >
      {(current, change, close) => (
        <ParentMenu
          value={current}
          projectId={projectId}
          exclude={exclude}
          isOpen={isOpen}
          onPick={(hit) => {
            setPicked(hit);
            change(hit ? hit.id : null);
            close();
          }}
        />
      )}
    </ComplexSelector>
  );
}
