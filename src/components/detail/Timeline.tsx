"use client";

/**
 * Activity timeline of one work item (docs/drafts/p7-plan.md §6): comments and
 * updates merged oldest first, the newest 20 until "Show older", then the
 * composer unless the item is read-only. All / Comments / Updates filters the
 * merge. A `#comment-<id>` hash scrolls to that comment once.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { entityRoute, type EntityLink } from "@/components/editor";
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
import { describeActivity } from "./activity-text";
import type { CommentView } from "./CommentItem";
import { CommentItem } from "./CommentItem";
import { CommentComposer } from "./CommentComposer";
import { matchWorkItemRef, toCandidates } from "./search-hits";
import { RelativeTime } from "./RelativeTime";
import { mergeTimeline, windowTimeline, type TimelineFilter } from "./timeline";

export type TimelineProps = {
  workItemId: string;
  projectId: string | null;
  comments: CommentView[];
  activity: ActivityLogEntry[];
  readOnly: boolean;
  currentActorId: string;
  mentionActors: readonly { id: string; name: string }[];
  onOpenItem: (id: string) => void;
};

const FILTERS: readonly { value: TimelineFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "comments", label: "Comments" },
  { value: "updates", label: "Updates" },
];

type TileIcon = typeof PencilIcon;

const VERB_ICONS: Readonly<Record<string, TileIcon>> = {
  created: PlusIcon,
  archived: ArchiveIcon,
  restored: RestoreIcon,
  deleted: TrashIcon,
  copied: CopyIcon,
  moved: TransferIcon,
};

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
  module: ModuleIcon,
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

function UpdateRow({ entry }: { entry: ActivityLogEntry }) {
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
      <RelativeTime value={entry.created_at} type="supporting" color="secondary" hasTooltip={false} className="tessera-detail-activity-time" />
    </HStack>
  );
}

function isFilter(value: string): value is TimelineFilter {
  return value === "all" || value === "comments" || value === "updates";
}

async function resolveWorkItemId(ref: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(ref)}&types=work_item&limit=1`);
    if (!response.ok) return null;
    return matchWorkItemRef(toCandidates(await response.json()), ref)?.id ?? null;
  } catch {
    return null;
  }
}

export function Timeline({ workItemId, projectId, comments, activity, readOnly, currentActorId, mentionActors, onOpenItem }: TimelineProps) {
  const toast = useToast();
  const router = useRouter();
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [showOlder, setShowOlder] = useState(false);
  const ordered = useMemo(() => mergeTimeline(comments, activity, filter), [activity, comments, filter]);
  const visible = windowTimeline(ordered, showOlder);
  const hidden = ordered.length - visible.length;

  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (!id.startsWith("comment-")) return;
    const frame = window.requestAnimationFrame(() => {
      setShowOlder(true);
      document.getElementById(id)?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [workItemId]);

  const openEntity = (link: EntityLink) => {
    if (link.scheme === "work") {
      void resolveWorkItemId(link.ref).then((id) => {
        if (id) onOpenItem(id);
        else toast({ type: "error", body: `No work item named ${link.ref}` });
      });
      return;
    }
    const route = entityRoute(link);
    if (route !== null) router.push(route);
    else toast({ type: "info", body: "That link is not a page in this workspace" });
  };

  const empty = filter === "comments" ? "No comments yet." : filter === "updates" ? "No updates yet." : "Nothing has happened here yet.";

  return (
    <VStack gap={3} className="tessera-timeline">
      <HStack gap={3} vAlign="center">
        <Text type="label" color="secondary">
          Activity
        </Text>
        <SegmentedControl label="Activity filter" size="sm" value={filter} onChange={(value) => isFilter(value) && setFilter(value)}>
          {FILTERS.map((item) => (
            <SegmentedControlItem key={item.value} value={item.value} label={item.label} />
          ))}
        </SegmentedControl>
      </HStack>
      {ordered.length === 0 ? (
        <Text type="supporting" color="secondary">
          {empty}
        </Text>
      ) : (
        <VStack gap={2}>
          {hidden > 0 ? (
            <HStack>
              <Button variant="ghost" size="sm" label={`Show older (${hidden})`} onClick={() => setShowOlder(true)} />
            </HStack>
          ) : null}
          <VStack gap={0} as="ul" aria-label="Activity" className="tessera-detail-timeline">
            {visible.map((entry) =>
              entry.kind === "comment" ? (
                <CommentItem
                  key={entry.comment.id}
                  comment={entry.comment}
                  rootId={entry.comment.id}
                  workItemId={workItemId}
                  projectId={projectId}
                  readOnly={readOnly}
                  currentActorId={currentActorId}
                  mentionActors={mentionActors}
                  onOpenEntity={openEntity}
                />
              ) : (
                <UpdateRow key={entry.activity.seq} entry={entry.activity} />
              ),
            )}
          </VStack>
        </VStack>
      )}
      {readOnly ? null : (
        <CommentComposer workItemId={workItemId} projectId={projectId} mentionActors={mentionActors} onOpenEntity={openEntity} />
      )}
    </VStack>
  );
}
