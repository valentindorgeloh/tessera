// @vitest-environment jsdom
/**
 * Inbox below 1024px and its rows (W1, W4, W9, W14 of the visual audit;
 * decision 14): the screen keeps one markup and lets inbox.css pick the pane, so
 * the markup carries the hook (`tessera-inbox--item`) and the way back. The row
 * keeps the unread dot's slot on a read row so the time text has one x. Server
 * markup only (`renderToString`); the actions, the router and the digest card
 * are mocked.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { InboxNote, InboxQuery } from "@/components/inbox/inbox-format";

const action = () => vi.fn(async () => ({ ok: true as const }));
vi.mock("@/app/actions/inbox", () => ({
  archiveNotificationsAction: action(),
  markNotificationsReadAction: action(),
  markNotificationsUnreadAction: action(),
  snoozeNotificationsAction: action(),
  unarchiveNotificationsAction: action(),
  unsnoozeNotificationsAction: action(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/components/ai/DigestCard", () => ({ DigestCard: () => null }));

const { InboxScreen } = await import("@/components/inbox/InboxScreen");
const { NotificationRow } = await import("@/components/inbox/NotificationRow");

function note(overrides: Partial<InboxNote> = {}): InboxNote {
  return {
    uid: "n1",
    seq: 1,
    kind: "commented",
    title: "Checkout",
    snippet: "Looks good",
    work_item_id: "item-1",
    work_item_key: "WEB-1",
    actor_name: "Ada",
    actor_kind: "user",
    read_at: null,
    archived_at: null,
    is_snoozed: false,
    event_count: 1,
    sort_at: "2026-10-22T10:00:00.000Z",
    created_at: "2026-10-22T10:00:00.000Z",
    ...overrides,
  };
}

function render(node: ReturnType<typeof createElement>): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = renderToString(node);
  return container;
}

function screen(query: Partial<InboxQuery>, notifications: InboxNote[] = [note()]) {
  return render(createElement(InboxScreen, { query: { tab: "inbox", unread: false, item: null, ...query }, notifications, digest: null, actorId: "me" }));
}

describe("Inbox screen", () => {
  it("names its first tab All, so the title and the tab do not repeat", () => {
    const tabs = [...screen({}).querySelectorAll(".astryx-tab")].map((tab) => (tab.textContent ?? "").replace(/^(.+)\1$/, "$1")); // an Astryx tab writes its label twice (a bold clone keeps the width steady)
    expect(tabs).toEqual(["All", "Mentions", "Snoozed", "Archived"]);
  });

  it("marks the layout and offers a Back button only while an item is open", () => {
    const empty = screen({});
    expect(empty.querySelector(".tessera-inbox--item")).toBeNull();
    expect(empty.querySelector(".tessera-inbox-back")).toBeNull();
    expect(empty.querySelector(".tessera-inbox-empty")).not.toBeNull();

    const open = screen({ item: "item-1" });
    expect(open.querySelector(".tessera-inbox.tessera-inbox--item")).not.toBeNull();
    const back = open.querySelector(".tessera-inbox-back");
    expect(back?.textContent).toContain("Back to notifications");
    expect(open.querySelector(".tessera-inbox-empty")).toBeNull();
  });
});

describe("Notification row", () => {
  const noop = () => {};
  const props = { isSelected: false, onOpen: noop, onMarkRead: noop, onMarkUnread: noop, onArchive: noop, onUnarchive: noop, onSnooze: noop, onSnoozeCustom: noop, onUnsnooze: noop };

  it("keeps the unread dot's slot on a read row, so the time text has one x", () => {
    const unread = render(createElement(NotificationRow, { ...props, note: note() }));
    const read = render(createElement(NotificationRow, { ...props, note: note({ read_at: "2026-10-22T11:00:00.000Z" }) }));
    expect(unread.querySelectorAll(".tessera-inbox-dot")).toHaveLength(1);
    expect(read.querySelectorAll(".tessera-inbox-dot")).toHaveLength(1);
    expect(unread.querySelector(".tessera-inbox-dot")?.childElementCount).toBe(1);
    expect(read.querySelector(".tessera-inbox-dot")?.childElementCount).toBe(0);
  });
});
