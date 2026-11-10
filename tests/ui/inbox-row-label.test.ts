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
import { agentGlyphSrc } from "@/themes/catppuccin/agent-glyph";
import { humanGlyphSrc } from "@/themes/catppuccin/human-glyph";

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
  actor_id: "agent-1",
  actor_name: "mcp:p3-acceptance-agent",
  actor_kind: "agent",
  actor_color: "teal",
  read_at: null,
  archived_at: null,
  is_snoozed: false,
  event_count: 2,
  kind_count: 2,
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

  it("shows an agent's glyph, a person's human glyph and a removed actor's initials", () => {
    const noop = () => {};
    const render = (row: InboxNote) =>
      renderToString(
        createElement(NotificationRow, {
          note: row,
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
    expect(render(note)).toContain(agentGlyphSrc({ id: "agent-1", kind: "agent", color: "teal" }));
    const person = render({ ...note, actor_name: "Ada", actor_kind: "user" });
    expect(person).toContain(humanGlyphSrc({ id: "agent-1", color: "teal" }));
    expect(person).not.toContain(agentGlyphSrc({ id: "agent-1", kind: "agent", color: "teal" }));
    expect(render({ ...note, actor_id: null, actor_kind: null, actor_color: null })).not.toContain("data:image/svg+xml");
  });

  it("renders '· +M more' in the label and no separate '+N' text in the row end", () => {
    const noop = () => {};
    const html = renderToString(
      createElement(NotificationRow, {
        note: { ...note, kind_count: 2, event_count: 3 },
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
    expect(html).toContain("mcp:p3-acceptance-agent commented 2 times · +1 more");
    expect(html).not.toMatch(/>\+\d+</);
  });
});
