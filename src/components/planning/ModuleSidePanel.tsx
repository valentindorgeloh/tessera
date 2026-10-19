"use client";

/**
 * The module detail's side panel (docs/contracts/ui.md "Modules (E2)"): an
 * Astryx `MetadataList` with the lead, members, start and target dates as
 * inline controls, then the links, then `ProgressPanel` without a chart (the
 * module chart arrives in P9). On an archived module every control is
 * read-only and the links cannot change. Writes go through the screen's
 * `ModuleWriter` (optimistic value, error Toast with the engine's message).
 */
import { DateInput } from "@astryxdesign/core/DateInput";
import { LayoutPanel } from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useProject } from "@/components/work-items/project-provider";
import { AssigneeControl } from "@/components/work-items/properties/AssigneeControl";
import { useWeekStart } from "@/components/workspace-settings/workspace-settings-store";
import type { ModuleDetail } from "@/lib/tessera/types";
import { CalendarIcon, TargetIcon, UserIcon, UsersIcon } from "@/themes/catppuccin/icons";
import { LeadControl } from "./LeadControl";
import { ModuleLinks } from "./ModuleLinks";
import type { ModuleWriter } from "./ModuleDetailScreen";
import { ProgressPanel } from "./ProgressPanel";

export type ModuleSidePanelProps = {
  /** The module with the writes in flight applied. */
  module: ModuleDetail;
  writer: ModuleWriter;
  /** True in an archived project (F3.4): every control and the links are read-only, like an archived module's. */
  readOnly?: boolean;
};

type IsoDate = Parameters<typeof DateInput>[0]["value"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asIsoDate(value: string | null): IsoDate {
  // Dates are stored through IsoDateSchema; the regex only guards against bad rows.
  return value && ISO_DATE.test(value) ? (value as NonNullable<IsoDate>) : undefined;
}

export function ModuleSidePanel({ module, writer, readOnly: projectReadOnly = false }: ModuleSidePanelProps) {
  const readOnly = projectReadOnly || module.archived_at !== null;
  const { progress } = module;
  const { bundle } = useProject();
  const weekStartsOn = useWeekStart(bundle.week_start);
  return (
    <LayoutPanel width={360} hasDivider padding={4} isScrollable label="Module details" role="complementary" className="tessera-planning-side-panel">
      <VStack gap={6}>
        {module.description_md.trim() !== "" ? (
          <Text type="body" color="secondary" className="tessera-modules-description">
            {module.description_md}
          </Text>
        ) : null}
        <MetadataList columns="single" label={{ position: "start", width: 104 }} className="tessera-modules-props">
          <MetadataListItem label="Lead" icon={<UserIcon />}>
            <LeadControl compact readOnly={readOnly} value={module.lead_actor_id} onChange={(lead_actor_id) => writer.update({ lead_actor_id })} />
          </MetadataListItem>
          <MetadataListItem label="Members" icon={<UsersIcon />}>
            <AssigneeControl label="Members" readOnly={readOnly} value={module.member_ids} onChange={writer.setMembers} />
          </MetadataListItem>
          <MetadataListItem label="Start date" icon={<CalendarIcon />}>
            <DateInput
              label="Start date"
              isLabelHidden
              size="sm"
              width="fill"
              value={asIsoDate(module.start_date)}
              max={asIsoDate(module.target_date)}
              onChange={(value) => writer.update({ start_date: value ?? null })}
              isDisabled={readOnly}
              hasClear
              format="date"
              placeholder="No start date"
              weekStartsOn={weekStartsOn}
              presentation="popover"
            />
          </MetadataListItem>
          <MetadataListItem label="Target date" icon={<TargetIcon />}>
            <DateInput
              label="Target date"
              isLabelHidden
              size="sm"
              width="fill"
              value={asIsoDate(module.target_date)}
              min={asIsoDate(module.start_date)}
              onChange={(value) => writer.update({ target_date: value ?? null })}
              isDisabled={readOnly}
              hasClear
              format="date"
              placeholder="No target date"
              weekStartsOn={weekStartsOn}
              presentation="popover"
            />
          </MetadataListItem>
        </MetadataList>
        <ModuleLinks moduleId={module.id} links={module.links} readOnly={readOnly} />
        <ProgressPanel
          title="Progress"
          counts={progress}
          points={progress.points}
          byState={progress.by_state}
          assignees={progress.assignees}
          labels={progress.labels}
          byAssignee={progress.by_assignee}
          byLabel={progress.by_label}
        />
      </VStack>
    </LayoutPanel>
  );
}
