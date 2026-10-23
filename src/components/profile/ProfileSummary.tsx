"use client";

/** Summary tab (docs/drafts/p9-plan.md U3): the count blocks, a state-group strip, a priority strip, projects and recent activity. */
import { Heading } from "@astryxdesign/core/Heading";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { ActivityList } from "@/components/profile/ProfileActivity";
import { openCount, PRIORITY_ORDER } from "@/components/profile/profile-format";
import { priorityOption } from "@/components/work-items/properties/PriorityControl";
import { stateGroupLabel, stateGroupVariant } from "@/components/work-items/properties/StateControl";
import { StateGroupSchema } from "@/lib/tessera/schemas";
import type { ProfileSummary as ProfileSummaryData } from "@/lib/tessera/types";
import "@/components/styles/profile.css";

export type ProfileSummaryProps = { summary: ProfileSummaryData };

export function ProfileSummary({ summary }: ProfileSummaryProps) {
  const assignedOpen = openCount(summary.assigned);
  const groups = StateGroupSchema.options.filter((group) => group !== "triage" || (summary.assigned.by_state_group[group] ?? 0) > 0);
  const priorityMax = Math.max(summary.assigned.total, 1);
  return (
    <VStack gap={6} padding={6}>
      <VStack gap={3}>
        <Heading level={2}>Numbers</Heading>
        <MetadataList columns={3}>
          <MetadataListItem label="Assigned open">
            <Text hasTabularNumbers>{assignedOpen}</Text>
          </MetadataListItem>
          <MetadataListItem label="Overdue">
            <Text hasTabularNumbers>{summary.assigned.overdue}</Text>
          </MetadataListItem>
          <MetadataListItem label="Due this week">
            <Text hasTabularNumbers>{summary.assigned.due_this_week}</Text>
          </MetadataListItem>
          <MetadataListItem label="Created open">
            <Text hasTabularNumbers>{openCount(summary.created)}</Text>
          </MetadataListItem>
          <MetadataListItem label="Subscribed open">
            <Text hasTabularNumbers>{openCount(summary.subscribed)}</Text>
          </MetadataListItem>
          <MetadataListItem label="Completed, 30 days">
            <Text hasTabularNumbers>{summary.completed_last_30d}</Text>
          </MetadataListItem>
        </MetadataList>
        <HStack gap={3} wrap="wrap">
          {groups.map((group) => (
            <HStack key={group} gap={1} vAlign="center">
              <StatusDot variant={stateGroupVariant(group)} label={stateGroupLabel(group)} />
              <Text type="supporting">{stateGroupLabel(group)}</Text>
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {summary.assigned.by_state_group[group] ?? 0}
              </Text>
            </HStack>
          ))}
        </HStack>
      </VStack>
      <VStack gap={3} className="tessera-profile-bars">
        <Heading level={2}>Priority</Heading>
        {PRIORITY_ORDER.map((priority) => (
          <ProgressBar
            key={priority}
            label={priorityOption(priority).label}
            value={summary.assigned.by_priority[priority] ?? 0}
            max={priorityMax}
            hasValueLabel
            formatValueLabel={(value) => String(value)}
          />
        ))}
      </VStack>
      <VStack gap={3}>
        <Heading level={2}>Projects</Heading>
        {summary.projects.length === 0 ? (
          <Text color="secondary">No open assigned work.</Text>
        ) : (
          <List hasDividers className="tessera-profile-list">
            {summary.projects.map((project) => (
              <ListItem
                key={project.project_id}
                href={`/projects/${project.project_id}`}
                label={project.name}
                description={project.assigned_open === 1 ? "1 open" : `${project.assigned_open} open`}
              />
            ))}
          </List>
        )}
      </VStack>
      <VStack gap={3}>
        <Heading level={2}>Recent activity</Heading>
        <ActivityList entries={summary.recent_activity} emptyTitle="No activity yet" />
      </VStack>
    </VStack>
  );
}
