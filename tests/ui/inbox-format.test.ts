/**
 * Inbox helpers (src/components/inbox/inbox-format.ts): phrases, the query,
 * tab membership, order and snooze presets.
 */
import { describe, expect, it } from "vitest";
import {
  formatLocalDateTime,
  inboxHref,
  matchesInboxTab,
  notificationDescription,
  notificationHref,
  notificationPhrase,
  parseInboxQuery,
  parseLocalDateTime,
  snoozeBounds,
  snoozePresets,
  sortInbox,
  SNOOZE_MAX_DAYS,
  type InboxNote,
} from "@/components/inbox/inbox-format";

function note(overrides: Partial<InboxNote> & Pick<InboxNote, "uid" | "seq">): InboxNote {
  return {
    kind: "commented",
    title: "Login page",
    snippet: "Needs review",
    work_item_id: "wi",
    work_item_key: "WEB-1",
    actor_name: "Ada",
    actor_kind: "user",
    read_at: null,
    archived_at: null,
    is_snoozed: false,
    event_count: 1,
    kind_count: 1,
    sort_at: "2026-10-01T00:00:00.000Z",
    created_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("notificationPhrase", () => {
  it("names the kind", () => {
    expect(notificationPhrase("mentioned")).toBe("mentioned you");
    expect(notificationPhrase("assigned")).toBe("assigned you");
    expect(notificationPhrase("state_changed")).toBe("changed the state");
    expect(notificationPhrase("commented")).toBe("commented");
    expect(notificationPhrase("custom_kind")).toBe("custom kind");
  });

  it("reads kind_count: 1 stays plain, 2 and 3 say N times, for every kind", () => {
    expect(notificationPhrase("commented", 1)).toBe("commented");
    expect(notificationPhrase("commented", 2)).toBe("commented 2 times");
    expect(notificationPhrase("commented", 3)).toBe("commented 3 times");
    expect(notificationPhrase("mentioned", 3)).toBe("mentioned you 3 times");
    expect(notificationPhrase("state_changed", 2)).toBe("changed the state 2 times");
  });

  it("appends the events of other kinds as \"· +M more\" (event_count - kind_count)", () => {
    expect(notificationPhrase("commented", 1, 1)).toBe("commented");
    expect(notificationPhrase("commented", 1, 2)).toBe("commented · +1 more");
    expect(notificationPhrase("commented", 2, 3)).toBe("commented 2 times · +1 more");
    expect(notificationPhrase("mentioned", 1, 3)).toBe("mentioned you · +2 more");
    expect(notificationPhrase("commented", 3, 3)).toBe("commented 3 times");
  });
});

describe("notificationHref", () => {
  const query = { tab: "mentions", unread: true } as const;

  it("opens a page row at the page and a work item row in the inbox pane", () => {
    expect(notificationHref({ work_item_id: null, entity_type: "page", entity_id: "p1" }, query)).toBe("/pages/p1");
    expect(notificationHref({ work_item_id: "w1", entity_type: "work_item", entity_id: "w1" }, query)).toBe("/inbox?tab=mentions&unread=1&item=w1");
    expect(notificationHref({ work_item_id: "w1" }, { tab: "inbox", unread: false })).toBe("/inbox?item=w1");
  });

  it("goes nowhere for a row with neither", () => {
    expect(notificationHref({ work_item_id: null, entity_type: "intake_item", entity_id: "i1" }, query)).toBeNull();
  });
});

describe("notificationDescription", () => {
  it("joins the key, title and snippet", () => {
    expect(notificationDescription(note({ uid: "a", seq: 1 }))).toBe("WEB-1 Login page · Needs review");
    expect(notificationDescription(note({ uid: "a", seq: 1, snippet: "" }))).toBe("WEB-1 Login page");
    expect(notificationDescription(note({ uid: "a", seq: 1, work_item_key: null, title: "", snippet: "Only this" }))).toBe("Only this");
  });
});

describe("parseInboxQuery and inboxHref", () => {
  it("defaults a missing or unknown tab and treats only unread=1 as unread", () => {
    expect(parseInboxQuery({})).toEqual({ tab: "inbox", unread: false, item: null });
    expect(parseInboxQuery({ tab: "nope", unread: "true", item: "" })).toEqual({ tab: "inbox", unread: false, item: null });
    expect(parseInboxQuery({ tab: ["mentions", "inbox"], unread: "1", item: "wi" })).toEqual({ tab: "mentions", unread: true, item: "wi" });
  });

  it("omits the default tab and empty flags", () => {
    expect(inboxHref("inbox", false, null)).toBe("/inbox");
    expect(inboxHref("mentions", true, "wi")).toBe("/inbox?tab=mentions&unread=1&item=wi");
    expect(inboxHref("snoozed", false, null)).toBe("/inbox?tab=snoozed");
    expect(parseInboxQuery({ tab: "archived", unread: "1", item: "wi" })).toEqual({ tab: "archived", unread: true, item: "wi" });
  });
});

describe("matchesInboxTab", () => {
  const unread = note({ uid: "u", seq: 1 });
  const read = note({ uid: "r", seq: 2, read_at: "2026-10-02T00:00:00.000Z" });
  const mention = note({ uid: "m", seq: 3, kind: "mentioned" });
  const snoozed = note({ uid: "s", seq: 4, is_snoozed: true });
  const archived = note({ uid: "a", seq: 5, archived_at: "2026-10-02T00:00:00.000Z", read_at: "2026-10-02T00:00:00.000Z" });

  it("splits inbox, mentions, snoozed and archived, then the unread toggle", () => {
    expect(matchesInboxTab(unread, "inbox", false)).toBe(true);
    expect(matchesInboxTab(read, "inbox", true)).toBe(false);
    expect(matchesInboxTab(snoozed, "inbox", false)).toBe(false);
    expect(matchesInboxTab(mention, "mentions", false)).toBe(true);
    expect(matchesInboxTab(unread, "mentions", false)).toBe(false);
    expect(matchesInboxTab(snoozed, "snoozed", true)).toBe(true);
    expect(matchesInboxTab(archived, "archived", false)).toBe(true);
    expect(matchesInboxTab(archived, "inbox", false)).toBe(false);
    expect(matchesInboxTab(archived, "archived", true)).toBe(false);
  });
});

describe("sortInbox", () => {
  it("orders by sort_at descending, then sequence", () => {
    const rows = [note({ uid: "old", seq: 1, sort_at: "2026-10-01T00:00:00.000Z" }), note({ uid: "new-b", seq: 3, sort_at: "2026-10-03T00:00:00.000Z" }), note({ uid: "new-a", seq: 9, sort_at: "2026-10-03T00:00:00.000Z" })];
    expect(sortInbox(rows).map((row) => row.uid)).toEqual(["new-a", "new-b", "old"]);
  });
});

describe("snoozePresets", () => {
  it("offers an hour, tomorrow at 09:00 and next Monday at 09:00", () => {
    const saturday = new Date(2026, 9, 17, 15, 30, 0);
    const presets = snoozePresets(saturday);
    expect(presets.map((preset) => preset.label)).toEqual(["1 hour", "Tomorrow 09:00", "Next Monday 09:00"]);
    expect(presets[0].until.getTime() - saturday.getTime()).toBe(60 * 60 * 1000);
    expect(presets[1].until.getDate()).toBe(18);
    expect(presets[1].until.getHours()).toBe(9);
    expect(presets[1].until.getMinutes()).toBe(0);
    expect(presets[2].until.getDate()).toBe(19);
    expect(presets[2].until.getDay()).toBe(1);
    expect(presets[2].until.getHours()).toBe(9);
  });

  it("moves Monday and Sunday onto the following Monday", () => {
    const monday = snoozePresets(new Date(2026, 9, 19, 10, 0, 0));
    expect(monday[2].until.getDate()).toBe(26);
    expect(monday[2].until.getDay()).toBe(1);
    const sunday = snoozePresets(new Date(2026, 9, 18, 12, 0, 0));
    expect(sunday[2].until.getDate()).toBe(19);
    expect(sunday[2].until.getDay()).toBe(1);
  });

  it("bounds a custom snooze from now through 90 days", () => {
    const now = new Date(2026, 9, 17, 15, 30, 0);
    const bounds = snoozeBounds(now);
    expect(bounds.min.getTime()).toBe(now.getTime());
    expect(bounds.max.getTime() - now.getTime()).toBe(SNOOZE_MAX_DAYS * 24 * 60 * 60 * 1000);
    expect(parseLocalDateTime(formatLocalDateTime(now))?.getTime()).toBe(new Date(2026, 9, 17, 15, 30, 0).getTime());
    expect(parseLocalDateTime("not-a-date")).toBeNull();
  });
});
