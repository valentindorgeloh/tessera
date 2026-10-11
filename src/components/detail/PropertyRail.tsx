"use client";

/**
 * Property rail (docs/contracts/ui.md "PropertyRail"): the P2a property
 * controls in an Astryx MetadataList, each inside a `data-property` wrapper
 * so the shortcut dispatcher can open it. Writes follow the QuickDetail
 * pattern through `useDetailActions` (action, Toast on `{ ok: false }`, the
 * host's `refresh()` brings the new data); values render from its optimistic
 * view, and unchanged values are dropped before any call (Selector and
 * DateInput re-fire them).
 *
 * One labelled column everywhere (the DateInput is about 220px wide, which
 * two columns in a 480px peek cannot hold); `compact` (the peek) only narrows
 * the label column. The controls keep their full form because the rail has
 * its own labels, which keeps the priority name and "No cycle" readable.
 * Dates use a DateInput with its label hidden, since the rail already shows
 * one (the P2a detail showed both).
 */
import type { ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { DateInput } from "@astryxdesign/core/DateInput";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack } from "@astryxdesign/core/Stack";
import { useProject } from "@/components/work-items/project-provider";
import { AssigneeControl, CycleControl, LabelControl, ModuleControl, PriorityControl, StateControl } from "@/components/work-items/properties";
import type { WorkItem, WorkItemDetail } from "@/lib/tessera/types";
import { BellIcon, BellSlashIcon } from "@/themes/catppuccin/icons";
import { ParentPicker } from "./ParentPicker";
import { storedIsoDate } from "./patch";
import { RelativeTime } from "./RelativeTime";
import { useDetailActions, type DetailActions } from "./use-detail-actions";

export type PropertyRailProps = {
  item: WorkItemDetail;
  currentActorId: string;
  /** Peek: a narrower label column. */
  compact?: boolean;
  /** Current parent, for the picker's trigger. */
  parent?: Pick<WorkItem, "id" | "key" | "name"> | null;
  /** Direct sub-items, excluded from the parent picker. */
  subItems?: readonly WorkItem[];
};

/** The property names the shortcut dispatcher opens (`div[data-property=…]`). */
export type PropertyName = "state" | "priority" | "assignees" | "labels" | "cycle" | "modules" | "start_date" | "target_date" | "parent" | "estimate" | "subscription";

/** The `div[data-property]` wrapper the shortcut dispatcher looks up (MetadataListItem spreads its own props onto the `<dt>`). */
function Property({ name, children }: { name: PropertyName; children: ReactNode }) {
  return (
    <HStack vAlign="center" data-property={name} className="tessera-detail-prop">
      {children}
    </HStack>
  );
}

type IsoDate = Parameters<typeof DateInput>[0]["value"];

type DatePropertyProps = {
  label: string;
  placeholder: string;
  value: string | null;
  min?: string | null;
  max?: string | null;
  readOnly: boolean;
  onChange: (value: string | null) => void;
};

/** Start or target date: DateInput with its own label hidden (the rail labels it), cleared to null. */
function DateProperty({ label, placeholder, value, min, max, readOnly, onChange }: DatePropertyProps) {
  // storedIsoDate checks the YYYY-MM-DD shape, which is DateInput's ISODateString template.
  const asInput = (date: string | null | undefined) => storedIsoDate(date) as IsoDate;
  return (
    <DateInput
      label={label}
      isLabelHidden
      size="sm"
      width="fill"
      value={asInput(value)}
      min={asInput(min)}
      max={asInput(max)}
      onChange={(next) => onChange(next ?? null)}
      isDisabled={readOnly}
      hasClear
      format="date"
      placeholder={placeholder}
    />
  );
}

export type PropertyRailFieldsProps = Omit<PropertyRailProps, "item" | "currentActorId"> & { actions: DetailActions };

/** The rail drawn from a shared `useDetailActions` result (WorkItemDetail passes the one its title and shortcuts use). */
export function PropertyRailFields({ actions, compact = false, parent = null, subItems = [] }: PropertyRailFieldsProps) {
  const { bundle } = useProject();
  const item = actions.view;
  const readOnly = item.archived_at !== null;
  return (
    <MetadataList columns="single" label={{ position: "start", width: compact ? 88 : 96 }} className="tessera-detail-props">
      <MetadataListItem label="State">
        <Property name="state">
          <StateControl readOnly={readOnly} value={item.state_id} onChange={(state_id) => actions.update({ state_id })} />
        </Property>
      </MetadataListItem>
      <MetadataListItem label="Priority">
        <Property name="priority">
          <PriorityControl readOnly={readOnly} value={item.priority} onChange={(priority) => actions.update({ priority })} />
        </Property>
      </MetadataListItem>
      <MetadataListItem label="Assignees">
        <Property name="assignees">
          <AssigneeControl readOnly={readOnly} value={item.assignee_ids} onChange={actions.setAssignees} />
        </Property>
      </MetadataListItem>
      <MetadataListItem label="Labels">
        <Property name="labels">
          <LabelControl readOnly={readOnly} value={item.label_ids} onChange={actions.setLabels} />
        </Property>
      </MetadataListItem>
      {bundle.project.cycles_enabled ? (
        <MetadataListItem label="Cycle">
          <Property name="cycle">
            <CycleControl readOnly={readOnly} value={item.cycle_id} onChange={(cycle_id) => actions.update({ cycle_id })} />
          </Property>
        </MetadataListItem>
      ) : null}
      {bundle.project.modules_enabled ? (
        <MetadataListItem label="Modules">
          <Property name="modules">
            <ModuleControl readOnly={readOnly} value={item.module_ids} onChange={actions.setModules} />
          </Property>
        </MetadataListItem>
      ) : null}
      <MetadataListItem label="Start date">
        <Property name="start_date">
          <DateProperty
            label="Start date"
            placeholder="No start date"
            readOnly={readOnly}
            value={item.start_date}
            max={item.target_date}
            onChange={(start_date) => actions.update({ start_date })}
          />
        </Property>
      </MetadataListItem>
      <MetadataListItem label="Target date">
        <Property name="target_date">
          <DateProperty
            label="Target date"
            placeholder="No target date"
            readOnly={readOnly}
            value={item.target_date}
            min={item.start_date}
            onChange={(target_date) => actions.update({ target_date })}
          />
        </Property>
      </MetadataListItem>
      <MetadataListItem label="Parent">
        <Property name="parent">
          <ParentPicker
            value={item.parent_id}
            parent={parent}
            projectId={item.project_id}
            excludeId={item.id}
            excludeIds={subItems.map((child) => child.id)}
            readOnly={readOnly}
            onChange={(parent_id) => actions.update({ parent_id })}
          />
        </Property>
      </MetadataListItem>
      <MetadataListItem label="Estimate">
        <Property name="estimate">
          <Selector label="Estimate" isLabelHidden variant="ghost" size="md" options={[]} value={undefined} placeholder="No estimate" isDisabled disabledMessage="Arrives in P8" />
        </Property>
      </MetadataListItem>
      <MetadataListItem label="Subscription">
        <Property name="subscription">
          <Button
            variant="ghost"
            size="md"
            icon={actions.isSubscribed ? <BellSlashIcon /> : <BellIcon />}
            label={actions.isSubscribed ? "Unsubscribe" : "Subscribe"}
            tooltip={actions.isSubscribed ? "Stop following this work item" : "Follow this work item (notifications arrive in P7)"}
            isDisabled={readOnly}
            onClick={() => void actions.toggleSubscribe()}
          />
        </Property>
      </MetadataListItem>
      <MetadataListItem label="Created">
        <RelativeTime value={item.created_at} type="body" color="primary" />
      </MetadataListItem>
      <MetadataListItem label="Updated">
        <RelativeTime value={item.updated_at} type="body" color="primary" />
      </MetadataListItem>
    </MetadataList>
  );
}

/** Contract surface `{ item, currentActorId, compact }`: the rail with its own writer, for screens that show it alone. */
export function PropertyRail({ item, currentActorId, ...rest }: PropertyRailProps) {
  const actions = useDetailActions(item, currentActorId);
  return <PropertyRailFields actions={actions} {...rest} />;
}
