"use client";

/**
 * One inbox row (docs/drafts/p7-plan.md §6): who did what, the work item and
 * snippet, the time and an unread dot. A coalesced row says so in its phrase
 * ("commented 2 times · +1 more", decision 51). The menu
 * marks read or unread, archives, and snoozes. The label is a <Text> so a long
 * actor name wraps at 375px instead of clipping "mentioned you" (a plain string
 * label is one line). Preset times are computed in
 * the click, not during render.
 */
import type { DropdownMenuItemData } from "@astryxdesign/core/DropdownMenu";
import { ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { ActorAvatar } from "@/components/shell/ActorAvatar";
import { ArchiveIcon, BellIcon, CheckIcon, ClockIcon, RestoreIcon } from "@/themes/catppuccin/icons";
import { notificationDescription, notificationPhrase, snoozePresets, type InboxNote, type SnoozePresetId } from "./inbox-format";

export type NotificationRowProps = {
  note: InboxNote;
  isSelected: boolean;
  onOpen: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onSnooze: (until: Date) => void;
  onSnoozeCustom: () => void;
  onUnsnooze: () => void;
};

export function NotificationRow({
  note,
  isSelected,
  onOpen,
  onMarkRead,
  onMarkUnread,
  onArchive,
  onUnarchive,
  onSnooze,
  onSnoozeCustom,
  onUnsnooze,
}: NotificationRowProps) {
  const actor = note.actor_name ?? "Someone";
  const { actor_id: actorId, actor_kind: actorKind, actor_color: actorColor } = note;
  const avatarActor = actorId !== null && actorKind !== null && actorColor !== null ? { id: actorId, name: actor, kind: actorKind, color: actorColor } : null;
  const phrase = notificationPhrase(note.kind, note.kind_count, note.event_count);
  const unread = note.read_at === null;
  const snooze = (id: SnoozePresetId) => {
    const preset = snoozePresets(new Date()).find((item) => item.id === id);
    if (preset) onSnooze(preset.until);
  };
  const items: DropdownMenuItemData[] = [
    unread
      ? { id: "read", label: "Mark read", icon: CheckIcon, onClick: onMarkRead }
      : { id: "unread", label: "Mark unread", icon: BellIcon, onClick: onMarkUnread },
    note.archived_at === null
      ? { id: "archive", label: "Archive", icon: ArchiveIcon, onClick: onArchive }
      : { id: "unarchive", label: "Unarchive", icon: RestoreIcon, onClick: onUnarchive },
  ];
  if (note.is_snoozed) items.push({ id: "unsnooze", label: "Unsnooze", icon: RestoreIcon, onClick: onUnsnooze });
  else if (note.archived_at === null) {
    items.push({
      id: "snooze",
      label: "Snooze",
      icon: ClockIcon,
      items: [
        { id: "hour", label: "1 hour", onClick: () => snooze("hour") },
        { id: "tomorrow", label: "Tomorrow 09:00", onClick: () => snooze("tomorrow") },
        { id: "monday", label: "Next Monday 09:00", onClick: () => snooze("monday") },
        { id: "custom", label: "Custom…", onClick: onSnoozeCustom },
      ],
    });
  }
  return (
    <ListItem
      label={<Text>{`${actor} ${phrase}`}</Text>}
      description={notificationDescription(note)}
      isSelected={isSelected}
      onClick={onOpen}
      startContent={<ActorAvatar actor={avatarActor} name={actor} size="sm" />}
      endContent={
        <HStack gap={2} vAlign="center" className="tessera-inbox-row-meta" onClick={(event) => event.stopPropagation()}>
          <RelativeTime value={note.sort_at || note.created_at} type="supporting" color="secondary" hasTooltip={false} />
          {/* The dot's slot stays on a read row, so the time text has one x on every row. */}
          <HStack hAlign="center" vAlign="center" className="tessera-inbox-dot">
            {unread ? <StatusDot variant="accent" label="Unread" /> : null}
          </HStack>
          <MoreMenu label={`Actions for ${actor}`} size="sm" items={items} />
        </HStack>
      }
    />
  );
}
