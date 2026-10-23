/**
 * Mentions (decision 53): `[@Name](actor:<id>)` links in a work item
 * description, a comment or a page body. Every save diffs the entity's
 * mention rows; an added actor gets one `mentioned` notification (and a
 * subscription for work items and comments), a removed one nobody.
 */
import { describe, expect, it } from "vitest";
import { notificationHref } from "@/components/inbox/inbox-format";
import { notificationPhrase } from "@/components/inbox/inbox-format";
import { registerActor } from "@/lib/tessera/actors";
import { setAssignees } from "@/lib/tessera/assignees";
import { createComment, updateComment } from "@/lib/tessera/comments";
import { withActor } from "@/lib/tessera/core/context";
import { activity, mention } from "@/lib/tessera/db/schema";
import { bodySnippet, extractActorMentions } from "@/lib/tessera/mentions";
import { listNotifications } from "@/lib/tessera/notifications";
import { createPage, duplicatePage, updatePageBody } from "@/lib/tessera/pages";
import { createProject } from "@/lib/tessera/projects";
import { createWorkItem, getWorkItem, updateWorkItemDescription } from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "./helpers/db";

const ID_A = "00000000-0000-7000-8000-0000000000aa";

function link(name: string, id: string): string {
  return `[@${name}](actor:${id})`;
}

function setup() {
  const handles = createTestDb();
  const user = createTestContext(handles);
  const project = createProject(user, { name: "Web", identifier: "WEB" });
  const item = createWorkItem(user, { project_id: project.id, name: "Login" });
  const writer = registerActor(user, { kind: "agent", name: "mcp:writer" });
  const target = registerActor(user, { kind: "agent", name: "mcp:target" });
  const writerCtx = withActor(user, writer.id);
  const targetCtx = withActor(user, target.id);
  const mentionRows = (entityType: string, entityId: string) =>
    handles.db.select().from(mention).all().filter((row) => row.entity_type === entityType && row.entity_id === entityId);
  const mentionActivity = (verb: string) => handles.db.select().from(activity).all().filter((row) => row.field === "mention" && row.verb === verb);
  return { handles, user, project, item, writer, target, writerCtx, targetCtx, mentionRows, mentionActivity };
}

describe("extractActorMentions", () => {
  it("returns unique ids and ignores fenced code and inline code", () => {
    const md = [
      `Hi ${link("A", ID_A)} and again ${link("A", ID_A)}`,
      "```md",
      link("Fenced", "00000000-0000-7000-8000-0000000000bb"),
      "```",
      `Inline \`${link("Code", "00000000-0000-7000-8000-0000000000cc")}\` stays text`,
      "~~~",
      link("Tilde", "00000000-0000-7000-8000-0000000000dd"),
      link("Unclosed", "00000000-0000-7000-8000-0000000000ee"),
    ].join("\n");
    expect(extractActorMentions(md)).toEqual([ID_A]);
  });

  it("skips a malformed id and a plain @Name", () => {
    expect(extractActorMentions("[@X](actor:not-an-id) and @Ada")).toEqual([]);
  });

  it("keeps the snippet helper's plain text", () => {
    expect(bodySnippet(`hello ${link("Ada", ID_A)}`)).toBe("hello @Ada");
  });
});

describe("syncMentions through the saves", () => {
  it("a description mention notifies once as mentioned and subscribes the actor", () => {
    const { writerCtx, targetCtx, target, item, mentionRows } = setup();
    updateWorkItemDescription(writerCtx, item.id, { description_md: `Please look ${link("Target", target.id)}`, expected_description_version: 0 });
    const rows = listNotifications(targetCtx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "mentioned", work_item_id: item.id, event_count: 1, entity_type: "work_item", entity_id: item.id });
    expect(rows[0]?.snippet).toBe("Please look @Target");
    expect(getWorkItem(writerCtx, item.id).subscriber_ids).toContain(target.id);
    expect(mentionRows("work_item", item.id).map((row) => row.actor_id)).toEqual([target.id]);
  });

  it("a re-save with the same body adds and notifies nothing", () => {
    const { writerCtx, targetCtx, target, item, mentionActivity } = setup();
    const body = `Look ${link("Target", target.id)}`;
    updateWorkItemDescription(writerCtx, item.id, { description_md: body, expected_description_version: 0 });
    updateWorkItemDescription(writerCtx, item.id, { description_md: `${body}\n\nMore text`, expected_description_version: 1 });
    // The only addition is the first one. The second save is an ordinary description change the now-subscribed actor hears about, merged into the same row.
    expect(mentionActivity("added")).toHaveLength(1);
    expect(listNotifications(targetCtx).map((note) => [note.kind, note.event_count])).toEqual([["mentioned", 2]]);
  });

  it("removing the mention notifies nobody and logs a removed row", () => {
    const { writerCtx, targetCtx, target, item, mentionRows, mentionActivity } = setup();
    updateWorkItemDescription(writerCtx, item.id, { description_md: link("Target", target.id), expected_description_version: 0 });
    updateWorkItemDescription(writerCtx, item.id, { description_md: "gone", expected_description_version: 1 });
    expect(mentionRows("work_item", item.id)).toHaveLength(0);
    expect(mentionActivity("removed")).toMatchObject([{ old_value: target.id, old_identifier: "mcp:target", entity_id: item.id }]);
    // One row, still a mention: the removal itself adds no event (the second save's description change is the only merge).
    expect(listNotifications(targetCtx).map((note) => [note.kind, note.event_count])).toEqual([["mentioned", 2]]);
  });

  it("a self-mention adds nothing", () => {
    const { writerCtx, writer, item, mentionRows, mentionActivity } = setup();
    updateWorkItemDescription(writerCtx, item.id, { description_md: `Me ${link("Me", writer.id)}`, expected_description_version: 0 });
    expect(mentionRows("work_item", item.id)).toHaveLength(0);
    expect(mentionActivity("added")).toHaveLength(0);
    expect(listNotifications(writerCtx)).toHaveLength(0);
  });

  it("a mention of an actor who already subscribes gives one mentioned row, event_count 1, and no updated row", () => {
    const { writerCtx, targetCtx, target, item } = setup();
    // The target subscribes through an earlier comment (an agent subscribes when it comments).
    createComment(targetCtx, item.id, { body_md: "I am watching" });
    expect(getWorkItem(writerCtx, item.id).subscriber_ids).toContain(target.id);
    updateWorkItemDescription(writerCtx, item.id, { description_md: `ping ${link("Target", target.id)}`, expected_description_version: 0 });
    expect(listNotifications(targetCtx).map((note) => [note.kind, note.event_count])).toEqual([["mentioned", 1]]);
  });

  it("creating an item that mentions and assigns the same actor is one 'mentioned you' row (createWorkItem logs only the silent created verb)", () => {
    const { writerCtx, targetCtx, project, target } = setup();
    createWorkItem(writerCtx, { project_id: project.id, name: "Both", description_md: `ping ${link("Target", target.id)}`, assignee_ids: [target.id] });
    const rows = listNotifications(targetCtx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "mentioned", kind_count: 1, event_count: 1 });
    expect(notificationPhrase(rows[0]!.kind, rows[0]!.kind_count, rows[0]!.event_count)).toBe("mentioned you");
  });

  it("an assignment then a mention of the same actor within ten minutes reads 'mentioned you · +1 more' (decision 51)", () => {
    const { writerCtx, targetCtx, target, item } = setup();
    setAssignees(writerCtx, item.id, [target.id]);
    expect(listNotifications(targetCtx).map((note) => [note.kind, note.kind_count, note.event_count])).toEqual([["assigned", 1, 1]]);
    updateWorkItemDescription(writerCtx, item.id, { description_md: `ping ${link("Target", target.id)}`, expected_description_version: 0 });
    const rows = listNotifications(targetCtx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "mentioned", kind_count: 1, event_count: 2 });
    expect(notificationPhrase(rows[0]!.kind, rows[0]!.kind_count, rows[0]!.event_count)).toBe("mentioned you · +1 more");
  });

  it("an already subscribed actor who is not mentioned still hears the description change", () => {
    const { writerCtx, user, item, target } = setup();
    updateWorkItemDescription(writerCtx, item.id, { description_md: `ping ${link("Target", target.id)}`, expected_description_version: 0 });
    expect(listNotifications(user).map((note) => [note.kind, note.event_count])).toEqual([["updated", 1]]);
  });

  it("an unknown actor id is skipped", () => {
    const { writerCtx, item, mentionRows } = setup();
    updateWorkItemDescription(writerCtx, item.id, { description_md: link("Ghost", "00000000-0000-7000-8000-0000000000f1"), expected_description_version: 0 });
    expect(mentionRows("work_item", item.id)).toHaveLength(0);
  });

  it("createWorkItem with a mention in its description notifies the actor", () => {
    const { writerCtx, targetCtx, target, project } = setup();
    const created = createWorkItem(writerCtx, { project_id: project.id, name: "New", description_md: `For ${link("Target", target.id)}` });
    const rows = listNotifications(targetCtx);
    expect(rows.map((note) => [note.kind, note.work_item_id])).toEqual([["mentioned", created.id]]);
  });

  it("the user is told when an agent mentions them in a description", () => {
    const { writerCtx, user, item } = setup();
    updateWorkItemDescription(writerCtx, item.id, { description_md: link("You", user.actor.id), expected_description_version: 0 });
    expect(listNotifications(user).map((note) => note.kind)).toEqual(["mentioned"]);
  });

  it("a comment mention notifies mentioned, not commented, and an edit that keeps it does not notify again", () => {
    const { writerCtx, targetCtx, target, item, mentionActivity } = setup();
    const created = createComment(writerCtx, item.id, { body_md: `Hi ${link("Target", target.id)}` });
    expect(listNotifications(targetCtx).map((note) => [note.kind, note.event_count])).toEqual([["mentioned", 1]]);
    updateComment(writerCtx, created.id, { body_md: `Hi again ${link("Target", target.id)}`, expected_body_version: 0 });
    expect(listNotifications(targetCtx).map((note) => [note.kind, note.event_count])).toEqual([["mentioned", 1]]);
    expect(mentionActivity("added")).toHaveLength(1);
  });
});

describe("page bodies", () => {
  it("a page-body mention notifies with the page, no work item and no subscription", () => {
    const { handles, writerCtx, targetCtx, target, project, mentionRows } = setup();
    const created = createPage(writerCtx, { project_id: project.id, name: "Spec" });
    updatePageBody(writerCtx, { page_id: created.id, description_md: `Review ${link("Target", target.id)}`, expected_description_version: 0 });
    const rows = listNotifications(targetCtx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "mentioned", entity_type: "page", entity_id: created.id, work_item_id: null, title: "Spec", project_id: project.id, work_item_key: null });
    expect(notificationHref(rows[0]!, { tab: "inbox", unread: false })).toBe(`/pages/${created.id}`);
    expect(mentionRows("page", created.id).map((row) => row.actor_id)).toEqual([target.id]);
    const subscribers = handles.sqlite.prepare("SELECT count(*) AS n FROM work_item_subscriber WHERE actor_id = ?").get(target.id) as { n: number };
    expect(subscribers.n).toBe(0);
  });

  it("a wiki page mention has no project, a re-save adds nothing and a removal notifies nobody", () => {
    const { writerCtx, targetCtx, target, mentionActivity } = setup();
    const created = createPage(writerCtx, { project_id: null, name: "Wiki note", description_md: `Hi ${link("Target", target.id)}` });
    expect(listNotifications(targetCtx)).toHaveLength(1);
    expect(listNotifications(targetCtx)[0]?.project_id).toBeNull();
    updatePageBody(writerCtx, { page_id: created.id, description_md: `Hi ${link("Target", target.id)} again`, expected_description_version: 0 });
    expect(listNotifications(targetCtx)).toHaveLength(1);
    updatePageBody(writerCtx, { page_id: created.id, description_md: "nothing", expected_description_version: 1 });
    expect(listNotifications(targetCtx)).toHaveLength(1);
    expect(mentionActivity("removed")).toHaveLength(1);
  });

  it("two page mentions in a row stay separate rows", () => {
    const { writerCtx, targetCtx, target } = setup();
    createPage(writerCtx, { project_id: null, name: "One", description_md: link("Target", target.id) });
    createPage(writerCtx, { project_id: null, name: "Two", description_md: link("Target", target.id) });
    expect(listNotifications(targetCtx).map((note) => note.title).sort()).toEqual(["One", "Two"]);
  });

  it("duplicating a page does not notify again", () => {
    const { writerCtx, targetCtx, target } = setup();
    const created = createPage(writerCtx, { project_id: null, name: "One", description_md: link("Target", target.id) });
    duplicatePage(writerCtx, created.id);
    expect(listNotifications(targetCtx)).toHaveLength(1);
  });

  it("a copy keeps its mention rows, so saving its unchanged body adds nothing (decision 53)", () => {
    const { writerCtx, targetCtx, target, mentionRows } = setup();
    const body = link("Target", target.id);
    const created = createPage(writerCtx, { project_id: null, name: "One", description_md: body });
    const copy = duplicatePage(writerCtx, created.id);
    expect(mentionRows("page", copy.id).map((row) => row.actor_id)).toEqual([target.id]);
    updatePageBody(writerCtx, { page_id: copy.id, description_md: body, expected_description_version: copy.description_version });
    expect(listNotifications(targetCtx).map((note) => note.title)).toEqual(["One"]);
  });
});

describe("notificationHref", () => {
  it("opens a work item row in the inbox detail pane and a row without either nowhere", () => {
    expect(notificationHref({ work_item_id: "w1", entity_type: "work_item", entity_id: "w1" }, { tab: "mentions", unread: true })).toBe("/inbox?tab=mentions&unread=1&item=w1");
    expect(notificationHref({ work_item_id: null, entity_type: "intake_item", entity_id: "i1" }, { tab: "inbox", unread: false })).toBeNull();
  });
});
