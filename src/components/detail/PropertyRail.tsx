"use client";

/**
 * Property rail (docs/contracts/ui.md "PropertyRail"): the P2a property
 * controls in Astryx MetadataLists, each inside a `data-property` wrapper so
 * the shortcut dispatcher can open it. Writes follow the QuickDetail pattern
 * through `useDetailActions` (action, Toast on `{ ok: false }`, the host's
 * `refresh()` brings the new data); values render from its optimistic view,
 * and unchanged values are dropped before any call (Selector and DateInput
 * re-fire them).
 *
 * Four groups split by hairlines: status (state, priority, labels), people
 * (assignees, subscription), planning (cycle, modules, parent, estimate) and
 * dates (start, target, created, updated). One labelled column everywhere,
 * the label an icon and muted text in a 120px column (104px in the peek,
 * `compact`); the DateInput is about 220px wide, which two columns in a
 * 480px peek cannot hold. Dates use a DateInput with its label hidden, since
 * the rail already shows one.
 */
import { Fragment, type ReactNode } from "react";
import { Button } from "@astryxdesign/core/Button";
import { DateInput } from "@astryxdesign/core/DateInput";
import { Divider } from "@astryxdesign/core/Divider";
import { Icon } from "@astryxdesign/core/Icon";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { useProject } from "@/components/work-items/project-provider";
import { AssigneeControl, CycleControl, EstimateControl, LabelControl, ModuleControl, PriorityControl, StateControl } from "@/components/work-items/properties";
import type { WorkItem, WorkItemDetail } from "@/lib/tessera/types";
import {
  BellIcon,
  BellSlashIcon,
  CalendarIcon,
  ClockIcon,
  CycleIcon,
  EstimateIcon,
  ModuleIcon,
  ParentIcon,
  PriorityMediumIcon,
  RecentIcon,
  StateIcon,
  TagIcon,
  TargetIcon,
  UsersIcon,
} from "@/themes/catppuccin/icons";
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

/** A rail label's icon: small and muted like the label text. */
function labelIcon(icon: typeof StateIcon) {
  return <Icon icon={icon} size="sm" color="secondary" />;
}

/** The rail drawn from a shared `useDetailActions` result (WorkItemDetail passes the one its title and shortcuts use). */
export function PropertyRailFields({ actions, compact = false, parent = null, subItems = [] }: PropertyRailFieldsProps) {
  const { bundle, statesById } = useProject();
  const item = actions.view;
  // Core change (P4 F3.4): the rail is read-only in an archived project too; this is where the rail decides it.
  const readOnly = item.archived_at !== null || bundle.project.archived_at !== null;
  const triageMessage = statesById.get(item.state_id)?.state_group === "triage" ? "Accept it in Intake to choose a state" : undefined;
  const label = { position: "start" as const, width: compact ? 104 : 120 };

  const groups: { id: string; items: ReactNode }[] = [
    {
      id: "status",
      items: (
        <>
          <MetadataListItem label="State" icon={labelIcon(StateIcon)}>
            <Property name="state">
              <StateControl readOnly={readOnly} disabledMessage={triageMessage} value={item.state_id} onChange={(state_id) => actions.update({ state_id })} />
            </Property>
          </MetadataListItem>
          <MetadataListItem label="Priority" icon={labelIcon(PriorityMediumIcon)}>
            <Property name="priority">
              <PriorityControl readOnly={readOnly} value={item.priority} onChange={(priority) => actions.update({ priority })} />
            </Property>
          </MetadataListItem>
          <MetadataListItem label="Labels" icon={labelIcon(TagIcon)}>
            <Property name="labels">
              <LabelControl readOnly={readOnly} value={item.label_ids} onChange={actions.setLabels} />
            </Property>
          </MetadataListItem>
        </>
      ),
    },
    {
      id: "people",
      items: (
        <>
          <MetadataListItem label="Assignees" icon={labelIcon(UsersIcon)}>
            <Property name="assignees">
              <AssigneeControl readOnly={readOnly} value={item.assignee_ids} onChange={actions.setAssignees} />
            </Property>
          </MetadataListItem>
          <MetadataListItem label="Subscription" icon={labelIcon(BellIcon)}>
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
        </>
      ),
    },
    {
      id: "planning",
      items: (
        <>
          {bundle.project.cycles_enabled ? (
            <MetadataListItem label="Cycle" icon={labelIcon(CycleIcon)}>
              <Property name="cycle">
                <CycleControl readOnly={readOnly} value={item.cycle_id} onChange={(cycle_id) => actions.update({ cycle_id })} />
              </Property>
            </MetadataListItem>
          ) : null}
          {bundle.project.modules_enabled ? (
            <MetadataListItem label="Modules" icon={labelIcon(ModuleIcon)}>
              <Property name="modules">
                <ModuleControl readOnly={readOnly} value={item.module_ids} onChange={actions.setModules} />
              </Property>
            </MetadataListItem>
          ) : null}
          <MetadataListItem label="Parent" icon={labelIcon(ParentIcon)}>
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
          {bundle.project.estimates_enabled && bundle.estimate ? (
            <MetadataListItem label="Estimate" icon={labelIcon(EstimateIcon)}>
              <Property name="estimate">
                <EstimateControl readOnly={readOnly} value={item.estimate_point_id} onChange={(estimate_point_id) => actions.update({ estimate_point_id })} />
              </Property>
            </MetadataListItem>
          ) : null}
        </>
      ),
    },
    {
      id: "dates",
      items: (
        <>
          <MetadataListItem label="Start date" icon={labelIcon(CalendarIcon)}>
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
          <MetadataListItem label="Target date" icon={labelIcon(TargetIcon)}>
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
          <MetadataListItem label="Created" icon={labelIcon(ClockIcon)}>
            <RelativeTime value={item.created_at} type="body" color="primary" />
          </MetadataListItem>
          <MetadataListItem label="Updated" icon={labelIcon(RecentIcon)}>
            <RelativeTime value={item.updated_at} type="body" color="primary" />
          </MetadataListItem>
        </>
      ),
    },
  ];

  return (
    <VStack gap={3} className="tessera-detail-props">
      {groups.map((group, index) => (
        <Fragment key={group.id}>
          {index > 0 ? <Divider /> : null}
          <MetadataList columns="single" label={label}>
            {group.items}
          </MetadataList>
        </Fragment>
      ))}
    </VStack>
  );
}

/** Contract surface `{ item, currentActorId, compact }`: the rail with its own writer, for screens that show it alone. */
export function PropertyRail({ item, currentActorId, ...rest }: PropertyRailProps) {
  const actions = useDetailActions(item, currentActorId);
  return <PropertyRailFields actions={actions} {...rest} />;
}
