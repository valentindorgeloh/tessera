// @vitest-environment jsdom
/**
 * Inbox row label at 375px (fix round e2e-b observation, decision 14): the
 * label is a Text, not a plain string, because ListItem clips a string label to
 * one line and a long actor name then hides "mentioned you" / "commented 2 times".
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { InboxNote } from "@/components/inbox/inbox-format";

vi.mock("@astryxdesign/core/MoreMenu", () => ({ MoreMenu: () => null }));
const { NotificationRow } = await import("@/components/inbox/NotificationRow");

const note: InboxNote = {
  uid: "n1",
  seq: 1,
  kind: "commented",
  title: "Checkout",
  snippet: "",
  work_item_id: "item-1",
  work_item_key: "WEB-1",
  actor_name: "mcp:p3-acceptance-agent",
  actor_kind: "agent",
  read_at: null,
  archived_at: null,
  is_snoozed: false,
  event_count: 2,
  sort_at: "2026-10-22T10:00:00.000Z",
  created_at: "2026-10-22T10:00:00.000Z",
};

describe("NotificationRow label", () => {
  it("passes a Text node as the ListItem label so the phrase wraps", () => {
    const source = readFileSync("src/components/inbox/NotificationRow.tsx", "utf8");
    expect(source).toMatch(/label=\{<Text>\{`\$\{actor\} \$\{phrase\}`\}<\/Text>\}/);
  });

  it("renders the actor and the full phrase", () => {
    const noop = () => {};
    const html = renderToString(
      createElement(NotificationRow, {
        note,
        isSelected: false,
        onOpen: noop,
        onMarkRead: noop,
        onMarkUnread: noop,
        onArchive: noop,
        onUnarchive: noop,
        onSnooze: noop,
        onSnoozeCustom: noop,
        onUnsnooze: noop,
      }),
    );
    expect(html).toContain("mcp:p3-acceptance-agent commented 2 times");
  });
});
