"use client";

/**
 * Inbox (docs/drafts/p7-plan.md §6): a notification list beside the selected
 * work item. Tabs and the unread toggle are links. Mark all as read, archive
 * and snooze go through the inbox actions.
 *
 * The page passes the caller's notifications and any stored inbox digest.
 * The digest card generates nothing on its own. Mark-read on row open stays
 * quiet when the action is unavailable, so opening an item does not toast.
 */
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Layout, LayoutContent, LayoutPanel } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { useToast } from "@astryxdesign/core/Toast";
import {
  archiveNotificationsAction,
  markNotificationsReadAction,
  markNotificationsUnreadAction,
  snoozeNotificationsAction,
  unarchiveNotificationsAction,
  unsnoozeNotificationsAction,
} from "@/app/actions/inbox";
import { DigestCard } from "@/components/ai/DigestCard";
import { PanelBar, PanelHeader, PanelTitle } from "@/components/shell/PanelHeader";
import type { DigestView } from "@/lib/tessera/types";
import { CheckIcon } from "@/themes/catppuccin/icons";
import { inboxHref, INBOX_TABS, matchesInboxTab, sortInbox, type InboxNote, type InboxQuery, type InboxTab } from "./inbox-format";
import { NotificationRow } from "./NotificationRow";
import { SnoozeDialog } from "./SnoozeDialog";

const TAB_LABELS: Readonly<Record<InboxTab, string>> = {
  inbox: "Inbox",
  mentions: "Mentions",
  snoozed: "Snoozed",
  archived: "Archived",
};

const LIST_MIN = 320;
const LIST_MAX = 560;
const LIST_DEFAULT = 400;

type InboxResult = { ok: true } | { ok: false; code: string; message: string };

export type InboxScreenProps = {
  query: InboxQuery;
  notifications: readonly InboxNote[];
  /** Stored inbox digest for `actorId`. Null until the person clicks Summarise. */
  digest: DigestView | null;
  actorId: string;
  children?: ReactNode;
};

export function InboxScreen({ query, notifications, digest, actorId, children }: InboxScreenProps) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [customUid, setCustomUid] = useState<string | null>(null);
  const [openedAt, setOpenedAt] = useState<Date | null>(null);
  const region = useResizable({ defaultSize: LIST_DEFAULT, minSize: LIST_MIN, maxSize: LIST_MAX, direction: "horizontal" });
  const visible = sortInbox(notifications.filter((note) => matchesInboxTab(note, query.tab, query.unread)));

  const run = (call: () => Promise<InboxResult>, prefix: string, quietUnavailable = false) => {
    startTransition(async () => {
      const result = await call();
      if (!result.ok && !(quietUnavailable && result.code === "UNAVAILABLE")) toast({ type: "error", body: `${prefix}: ${result.message}` });
    });
  };

  const open = (note: InboxNote) => {
    if (note.read_at === null) run(() => markNotificationsReadAction({ ids: [note.uid] }), "Could not mark as read", true);
    if (note.work_item_id !== null) router.push(inboxHref(query.tab, query.unread, note.work_item_id));
  };

  const snooze = (uid: string, until: Date) => {
    run(() => snoozeNotificationsAction({ ids: [uid], until: until.toISOString() }), "Could not snooze");
  };

  return (
    <>
    <Layout
      height="fill"
      className="tessera-inbox"
      header={
        <PanelHeader label="Inbox">
          <PanelBar
            start={
              <>
                <PanelTitle>Inbox</PanelTitle>
                <TabList value={query.tab} onChange={() => {}} size="sm" layout="hug" aria-label="Inbox">
                  {INBOX_TABS.map((tab) => (
                    <Tab key={tab} value={tab} label={TAB_LABELS[tab]} href={inboxHref(tab, query.unread, query.item)} />
                  ))}
                </TabList>
              </>
            }
            end={
              <>
                <ToggleButton
                  label="Unread"
                  size="sm"
                  isPressed={query.unread}
                  onPressedChange={() => router.push(inboxHref(query.tab, !query.unread, query.item))}
                />
                <MoreMenu
                  label="Inbox actions"
                  size="sm"
                  items={[
                    {
                      id: "read-all",
                      label: "Mark all as read",
                      icon: CheckIcon,
                      onClick: () => run(() => markNotificationsReadAction({ ids: visible.map((note) => note.uid), all: true }), "Could not mark all as read"),
                    },
                  ]}
                />
              </>
            }
          />
        </PanelHeader>
      }
      start={
        <>
          <LayoutPanel className="tessera-inbox-list" resizable={region.props} hasDivider padding={0} isScrollable label="Notifications">
            <DigestCard kind="inbox" id={actorId} digest={digest} />
            <List aria-label="Notifications" hasDividers>
              {visible.length === 0 ? (
                <ListItem label="No notifications" description={query.unread ? "Nothing unread in this tab." : "You are caught up."} />
              ) : (
                visible.map((note) => (
                  <NotificationRow
                    key={note.uid}
                    note={note}
                    isSelected={query.item !== null && note.work_item_id === query.item}
                    onOpen={() => open(note)}
                    onMarkRead={() => run(() => markNotificationsReadAction({ ids: [note.uid] }), "Could not mark as read")}
                    onMarkUnread={() => run(() => markNotificationsUnreadAction({ ids: [note.uid] }), "Could not mark as unread")}
                    onArchive={() => run(() => archiveNotificationsAction({ ids: [note.uid] }), "Could not archive")}
                    onUnarchive={() => run(() => unarchiveNotificationsAction({ ids: [note.uid] }), "Could not unarchive")}
                    onSnooze={(until) => snooze(note.uid, until)}
                    onSnoozeCustom={() => {
                      setCustomUid(note.uid);
                      setOpenedAt(new Date());
                    }}
                    onUnsnooze={() => run(() => unsnoozeNotificationsAction({ ids: [note.uid] }), "Could not unsnooze")}
                  />
                ))
              )}
            </List>
          </LayoutPanel>
          <ResizeHandle resizable={region.props} direction="horizontal" hasDivider={false} label="Resize notifications" />
        </>
      }
      content={
        <LayoutContent padding={0} isScrollable className="tessera-inbox-detail">
          {query.item === null ? <EmptyState title="Select a notification" description="The work item opens here." headingLevel={2} /> : children}
        </LayoutContent>
      }
    />
    <SnoozeDialog
      isOpen={customUid !== null}
      openedAt={openedAt}
      onOpenChange={(open) => {
        if (!open) setCustomUid(null);
      }}
      onConfirm={(until) => {
        if (customUid !== null) snooze(customUid, until);
        setCustomUid(null);
      }}
    />
    </>
  );
}
