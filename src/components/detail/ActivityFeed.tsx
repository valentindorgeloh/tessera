"use client";

/**
 * Activity feed of one work item (docs/contracts/ui.md "ActivityFeed"): a
 * timeline, newest first. Each entry is a small icon tile for the kind of
 * change on a hairline that joins the tiles, the actor's name, the change in
 * words and a relative timestamp. Collapsed to the newest 20 until "Show
 * all". No client fetch; the host reloads the entries on `refresh()`.
 */
import { useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { ActivityLogEntry } from "@/lib/tessera/types";
import {
  ArchiveIcon,
  BellIcon,
  CalendarIcon,
  CopyIcon,
  CycleIcon,
  DescriptionIcon,
  EstimateIcon,
  FolderIcon,
  LinkIcon,
  ListBulletsIcon,
  ModuleIcon,
  ParentIcon,
  PencilIcon,
  PlusIcon,
  PriorityMediumIcon,
  ReorderIcon,
  RestoreIcon,
  StateIcon,
  TagIcon,
  TargetIcon,
  TransferIcon,
  TrashIcon,
  UsersIcon,
} from "@/themes/catppuccin/icons";
import { describeActivity, newestFirst } from "./activity-text";
import { RelativeTime } from "./RelativeTime";

export const ACTIVITY_PREVIEW_COUNT = 20;

export type ActivityFeedProps = {
  entries: ActivityLogEntry[];
};

type TileIcon = typeof PencilIcon;

/** Tiles of the verbs that are about the whole item. */
const VERB_ICONS: Readonly<Record<string, TileIcon>> = {
  created: PlusIcon,
  archived: ArchiveIcon,
  restored: RestoreIcon,
  deleted: TrashIcon,
  copied: CopyIcon,
  moved: TransferIcon,
};

/** Tiles of the field an update, an add or a remove touched (the fields of activity-text.ts). */
const FIELD_ICONS: Readonly<Record<string, TileIcon>> = {
  name: PencilIcon,
  state_id: StateIcon,
  priority: PriorityMediumIcon,
  parent_id: ParentIcon,
  cycle_id: CycleIcon,
  estimate_point_id: EstimateIcon,
  start_date: CalendarIcon,
  target_date: TargetIcon,
  description_md: DescriptionIcon,
  project_id: FolderIcon,
  sort_order: ReorderIcon,
  labels: TagIcon,
  modules: ModuleIcon,
  assignees: UsersIcon,
  subscribers: BellIcon,
  link: LinkIcon,
  link_title: LinkIcon,
  link_url: LinkIcon,
  work_item: ListBulletsIcon,
};

function tileIcon(entry: ActivityLogEntry): TileIcon {
  return VERB_ICONS[entry.verb] ?? (entry.field !== null ? FIELD_ICONS[entry.field] : undefined) ?? PencilIcon;
}

function ActivityRow({ entry }: { entry: ActivityLogEntry }) {
  return (
    <HStack gap={3} vAlign="center" className="tessera-detail-activity-row" as="li">
      <HStack hAlign="center" vAlign="center" className="tessera-detail-activity-tile">
        <Icon icon={tileIcon(entry)} size="sm" color="secondary" />
      </HStack>
      <Text type="supporting" className="tessera-detail-activity-text">
        <Text type="inherit" weight="medium">
          {entry.actor_name}
        </Text>{" "}
        {describeActivity(entry, entry.actor_name)}
      </Text>
      <RelativeTime value={entry.created_at} type="supporting" color="secondary" className="tessera-detail-activity-time" />
    </HStack>
  );
}

export function ActivityFeed({ entries }: ActivityFeedProps) {
  const [showAll, setShowAll] = useState(false);
  const ordered = useMemo(() => newestFirst(entries), [entries]);
  const visible = showAll ? ordered : ordered.slice(0, ACTIVITY_PREVIEW_COUNT);
  const hidden = ordered.length - visible.length;
  return (
    <VStack gap={2} className="tessera-detail-activity">
      <Text type="label" color="secondary">
        Activity
      </Text>
      {ordered.length === 0 ? (
        <Text type="supporting" color="secondary">
          Nothing has happened here yet.
        </Text>
      ) : (
        <VStack gap={0} as="ul" aria-label="Activity" className="tessera-detail-timeline">
          {visible.map((entry) => (
            <ActivityRow key={entry.seq} entry={entry} />
          ))}
        </VStack>
      )}
      {hidden > 0 ? (
        <HStack>
          <Button variant="ghost" size="sm" label={`Show all (${ordered.length})`} onClick={() => setShowAll(true)} />
        </HStack>
      ) : null}
    </VStack>
  );
}
