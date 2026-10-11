"use client";

/**
 * Activity feed of one work item (docs/contracts/ui.md "ActivityFeed"): one
 * row per entry, newest first, with the actor's avatar, the change in words
 * and a relative timestamp. Collapsed to the newest 20 until "Show all". No
 * client fetch; the host reloads the entries on `refresh()`.
 */
import { useMemo, useState } from "react";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { ActivityLogEntry } from "@/lib/tessera/types";
import { describeActivity, newestFirst } from "./activity-text";
import { RelativeTime } from "./RelativeTime";

export const ACTIVITY_PREVIEW_COUNT = 20;

export type ActivityFeedProps = {
  entries: ActivityLogEntry[];
};

function ActivityRow({ entry }: { entry: ActivityLogEntry }) {
  return (
    <HStack gap={2} vAlign="start" className="tessera-detail-activity-row" as="li">
      <Avatar name={entry.actor_name} size="xsm" tooltip={false} />
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
        <VStack gap={0} as="ul" aria-label="Activity">
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
