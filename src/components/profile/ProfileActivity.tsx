"use client";

/**
 * Activity of one actor (docs/drafts/p9-plan.md U3), newest first and grouped
 * by the local day. "Load more" asks for the next older page with `?before`.
 */
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { describeActivity } from "@/components/detail/activity-text";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { localDateOf } from "@/lib/tessera/core/time";
import type { ActivityLogEntry } from "@/lib/tessera/types";

export type ActivityListProps = {
  entries: ActivityLogEntry[];
  emptyTitle: string;
};

function activityHref(entry: ActivityLogEntry): string | undefined {
  if (entry.work_item_id) return `/work-items/${entry.work_item_id}`;
  if (entry.entity_type === "work_item") return `/work-items/${entry.entity_id}`;
  return undefined;
}

function activityDetail(entry: ActivityLogEntry): string {
  const named = entry.new_identifier ?? entry.old_identifier;
  if (named && named !== "") return named;
  return entry.entity_type === "work_item" ? "Work item" : entry.entity_type;
}

export function ActivityList({ entries, emptyTitle }: ActivityListProps) {
  if (entries.length === 0) return <Text color="secondary">{emptyTitle}</Text>;
  const newest = [...entries].reverse();
  const days: { day: string; rows: ActivityLogEntry[] }[] = [];
  for (const entry of newest) {
    const day = localDateOf(entry.created_at);
    const last = days[days.length - 1];
    if (last && last.day === day) last.rows.push(entry);
    else days.push({ day, rows: [entry] });
  }
  return (
    <VStack gap={4}>
      {days.map((group) => (
        <VStack key={group.day} gap={2}>
          <Heading level={3}>{group.day}</Heading>
          <List hasDividers>
            {group.rows.map((entry) => (
              <ListItem
                key={entry.uid}
                href={activityHref(entry)}
                label={`${entry.actor_name} ${describeActivity(entry)}`}
                description={activityDetail(entry)}
                endContent={<RelativeTime value={entry.created_at} type="supporting" color="secondary" hasTooltip={false} />}
              />
            ))}
          </List>
        </VStack>
      ))}
    </VStack>
  );
}

export type ProfileActivityProps = {
  entries: ActivityLogEntry[];
  olderHref: string | null;
  newerHref: string | null;
};

export function ProfileActivity({ entries, olderHref, newerHref }: ProfileActivityProps) {
  return (
    <VStack gap={4} padding={6}>
      <Heading level={2}>Activity</Heading>
      <ActivityList entries={entries} emptyTitle="No activity yet" />
      {olderHref || newerHref ? (
        <HStack gap={4}>
          {newerHref ? <Link href={newerHref}>Newer</Link> : null}
          {olderHref ? <Link href={olderHref}>Load more</Link> : null}
        </HStack>
      ) : null}
    </VStack>
  );
}
