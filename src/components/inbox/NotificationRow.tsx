"use client";

/**
 * One inbox row (docs/drafts/p7-plan.md §6): who did what, the work item and
 * snippet, the time, an unread dot, and "+N" when the row coalesced. The menu
 * marks read or unread, archives, and snoozes. Preset times are computed in
 * the click, not during render.
 */
import type { DropdownMenuItemData } from "@astryxdesign/core/DropdownMenu";
import { Avatar } from "@astryxdesign/core/Avatar";
import { ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { HStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { RelativeTime } from "@/components/detail/RelativeTime";
import { ArchiveIcon, BellIcon, CheckIcon, ClockIcon, RestoreIcon } from "@/themes/catppuccin/icons";
import { extraEventLabel, notificationDescription, notificationPhrase, snoozePresets, type InboxNote, type SnoozePresetId } from "./inbox-format";

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
  const phrase = notificationPhrase(note.kind, note.event_count);
  const extra = extraEventLabel(note.event_count);
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
      label={`${actor} ${phrase}`}
      description={notificationDescription(note)}
      isSelected={isSelected}
      onClick={onOpen}
      startContent={<Avatar name={actor} size="sm" />}
      endContent={
        <HStack gap={2} vAlign="center" className="tessera-inbox-row-meta" onClick={(event) => event.stopPropagation()}>
          {extra !== null ? (
            <Text type="supporting" color="secondary" hasTabularNumbers>
              {extra}
            </Text>
          ) : null}
          <RelativeTime value={note.sort_at || note.created_at} type="supporting" color="secondary" hasTooltip={false} />
          {unread ? <StatusDot variant="accent" label="Unread" /> : null}
          <MoreMenu label={`Actions for ${actor}`} size="sm" items={items} />
        </HStack>
      }
    />
  );
}
