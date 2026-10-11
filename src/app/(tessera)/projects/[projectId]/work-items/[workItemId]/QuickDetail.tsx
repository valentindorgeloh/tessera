"use client";

/**
 * Minimal work item detail (P2a): key, editable name, plain-text description
 * with autosave and the property controls. Lane D's P2b detail page replaces
 * this file (Markdown editor, conflict banner, sendBeacon flush).
 *
 * Drafts follow the server: a name or description that changes elsewhere
 * (the change poller's refresh) replaces the draft unless it holds unsaved
 * edits, and a failed name save puts the server name back. The description
 * saves 150 ms after the last keystroke, on blur and on unmount through
 * `updateWorkItemDescriptionAction` with the description_version the client
 * last saw, so a body changed elsewhere while the draft was dirty fails with
 * CONFLICT and a toast instead of overwriting it.
 */
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import {
  setAssigneesAction,
  setLabelsAction,
  setModulesAction,
  updateWorkItemAction,
  updateWorkItemDescriptionAction,
} from "@/app/actions/work-items";
import { useProject } from "@/components/work-items/project-provider";
import { AssigneeControl, CycleControl, DateControl, LabelControl, ModuleControl, PriorityControl, StateControl } from "@/components/work-items/properties";
import type { UpdateWorkItemPatch } from "@/components/work-items/types";
import type { WorkItemDetail } from "@/lib/tessera/types";

/** Delay between the last keystroke and the description save. */
const DESCRIPTION_SAVE_DELAY_MS = 150;

function dayOf(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

type Notify = (message: string) => void;

/**
 * Description draft with debounced autosave. `value` is what the textarea
 * shows, `saved` the text last written to or adopted from the server; the
 * draft is dirty while they differ.
 */
function useDescriptionDraft(item: WorkItemDetail, fail: Notify) {
  const [value, setValue] = useState(item.description_md);
  const [saved, setSaved] = useState(item.description_md);
  const [source, setSource] = useState(item.description_md);
  if (source !== item.description_md) {
    // The server text changed (own save landed or someone else wrote): adopt it unless the draft has unsaved edits.
    setSource(item.description_md);
    if (value === saved) {
      setValue(item.description_md);
      setSaved(item.description_md);
    }
  }

  const versionRef = useRef(item.description_version);
  const sentRef = useRef<string | null>(item.description_md);
  const latestRef = useRef(item.description_md);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  // A newer server version is adopted only while nothing is unsaved; own saves move versionRef from the action result.
  useEffect(() => {
    if (item.description_version > versionRef.current && value === saved) versionRef.current = item.description_version;
  }, [item.description_version, saved, value]);

  const save = useCallback(
    (text: string) => {
      if (text === sentRef.current) return;
      sentRef.current = text;
      // One save at a time so every call carries the version the previous one produced.
      queueRef.current = queueRef.current.then(async () => {
        const result = await updateWorkItemDescriptionAction({
          work_item_id: item.id,
          description_md: text,
          expected_description_version: versionRef.current,
        });
        if (result.ok) {
          versionRef.current = result.data.description_version;
          setSaved(text);
          return;
        }
        sentRef.current = null;
        fail(result.code === "CONFLICT" ? "the description changed elsewhere; reload to see the latest version" : result.message);
      });
    },
    [fail, item.id],
  );

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const onChange = (text: string) => {
    setValue(text);
    latestRef.current = text;
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      save(text);
    }, DESCRIPTION_SAVE_DELAY_MS);
  };

  const flush = () => {
    clearTimer();
    save(latestRef.current);
  };

  // Leaving the page with a pending save sends it right away.
  useEffect(
    () => () => {
      if (timerRef.current === null) return;
      clearTimeout(timerRef.current);
      timerRef.current = null;
      save(latestRef.current);
    },
    [save],
  );

  return { value, onChange, flush, isDirty: value !== saved };
}

export function QuickDetail({ item }: { item: WorkItemDetail }) {
  const toast = useToast();
  const { bundle } = useProject();
  const fail = useCallback<Notify>((message) => toast({ type: "error", body: `Could not save: ${message}` }), [toast]);

  // The name draft resets whenever the server's name changes (a rename from elsewhere).
  const [name, setName] = useState(item.name);
  const [nameSource, setNameSource] = useState(item.name);
  if (nameSource !== item.name) {
    setNameSource(item.name);
    setName(item.name);
  }

  const update = (patch: UpdateWorkItemPatch) => {
    startTransition(async () => {
      const result = await updateWorkItemAction({ work_item_id: item.id, ...patch });
      if (!result.ok) {
        fail(result.message);
        // A rejected rename would otherwise stay in the field and be re-sent on the next blur.
        if (patch.name !== undefined) setName(item.name);
      }
    });
  };

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(item.name);
      return;
    }
    if (trimmed !== item.name) update({ name: trimmed });
  };

  const description = useDescriptionDraft(item, fail);

  return (
    <VStack gap={5} padding={6} className="tessera-wi-detail">
      <HStack gap={3} vAlign="center" hAlign="between">
        <Text type="label" color="secondary" hasTabularNumbers>
          {item.key}
        </Text>
        <Button variant="ghost" size="sm" label="All work items" href={`/projects/${item.project_id}/work-items`} />
      </HStack>
      <TextInput label="Name" isLabelHidden size="lg" value={name} onChange={setName} onBlur={commitName} onEnter={commitName} />
      <VStack gap={1}>
        <TextArea
          label="Description"
          value={description.value}
          onChange={description.onChange}
          onBlur={() => description.flush()}
          rows={8}
          placeholder="Add context, links or acceptance criteria"
        />
        <Text type="supporting" color="secondary" aria-live="polite">
          {description.isDirty ? "Saving…" : "Saved"}
        </Text>
      </VStack>
      <MetadataList title="Properties" columns="single">
        <MetadataListItem label="State">
          <StateControl value={item.state_id} onChange={(state_id) => update({ state_id })} />
        </MetadataListItem>
        <MetadataListItem label="Priority">
          <PriorityControl value={item.priority} onChange={(priority) => update({ priority })} />
        </MetadataListItem>
        <MetadataListItem label="Assignees">
          <AssigneeControl
            value={item.assignee_ids}
            onChange={(assignee_ids) =>
              startTransition(async () => {
                const result = await setAssigneesAction({ work_item_id: item.id, actor_ids: assignee_ids });
                if (!result.ok) fail(result.message);
              })
            }
          />
        </MetadataListItem>
        <MetadataListItem label="Labels">
          <LabelControl
            value={item.label_ids}
            onChange={(label_ids) =>
              startTransition(async () => {
                const result = await setLabelsAction({ work_item_id: item.id, label_ids });
                if (!result.ok) fail(result.message);
              })
            }
          />
        </MetadataListItem>
        {bundle.project.cycles_enabled ? (
          <MetadataListItem label="Cycle">
            <CycleControl value={item.cycle_id} onChange={(cycle_id) => update({ cycle_id })} />
          </MetadataListItem>
        ) : null}
        {bundle.project.modules_enabled ? (
          <MetadataListItem label="Modules">
            <ModuleControl
              value={item.module_ids}
              onChange={(module_ids) =>
                startTransition(async () => {
                  const result = await setModulesAction({ work_item_id: item.id, module_ids });
                  if (!result.ok) fail(result.message);
                })
              }
            />
          </MetadataListItem>
        ) : null}
        <MetadataListItem label="Start date">
          <DateControl label="Start date" value={item.start_date} max={item.target_date} onChange={(start_date) => update({ start_date })} />
        </MetadataListItem>
        <MetadataListItem label="Target date">
          <DateControl label="Target date" value={item.target_date} min={item.start_date} onChange={(target_date) => update({ target_date })} />
        </MetadataListItem>
        <MetadataListItem label="Created">
          <Text hasTabularNumbers>{dayOf(item.created_at)}</Text>
        </MetadataListItem>
        <MetadataListItem label="Updated">
          <Text hasTabularNumbers>{dayOf(item.updated_at)}</Text>
        </MetadataListItem>
      </MetadataList>
    </VStack>
  );
}
