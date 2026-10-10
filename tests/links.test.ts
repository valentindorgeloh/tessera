import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { latestSeq } from "@/lib/tessera/activity";
import { TrackerError } from "@/lib/tessera/core/errors";
import { newId } from "@/lib/tessera/core/ids";
import { firstSortOrder } from "@/lib/tessera/core/order";
import { activity, module_link, work_item, work_item_link } from "@/lib/tessera/db/schema";
import { addLink, countLinks, getLink, isHttpUrl, linkLabel, listLinks, removeLink, updateLink } from "@/lib/tessera/links";
import { archiveModule, createModule } from "@/lib/tessera/modules";
import { archiveProject, createProject } from "@/lib/tessera/projects";
import { listStates } from "@/lib/tessera/states";
import { createTestContext, createTestDb, type TesseraContext } from "./helpers/db";

type Fixture = { ctx: TesseraContext; projectId: string; stateId: string };

function setup(): Fixture {
  const ctx = createTestContext(createTestDb());
  const p = createProject(ctx, { name: "Web", identifier: "WEB" });
  return { ctx, projectId: p.id, stateId: listStates(ctx, p.id)[0].id };
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TrackerError) return err.code;
    throw err;
  }
  return undefined;
}

let sequence = 0;

function insertWorkItem(ctx: TesseraContext, projectId: string, stateId: string, name: string, extra: Partial<typeof work_item.$inferInsert> = {}) {
  const now = ctx.now();
  sequence += 1;
  return ctx.db
    .insert(work_item)
    .values({
      id: newId(),
      project_id: projectId,
      sequence_id: sequence,
      name,
      state_id: stateId,
      sort_order: firstSortOrder(),
      created_at: now,
      updated_at: now,
      created_by: ctx.actor.id,
      updated_by: ctx.actor.id,
      ...extra,
    })
    .returning()
    .get();
}

function rowsSince(ctx: TesseraContext, seq: number) {
  return ctx.db
    .select()
    .from(activity)
    .orderBy(activity.seq)
    .all()
    .filter((row) => row.seq > seq);
}

describe("addLink", () => {
  it("adds a link to a work item with defaults, appends sort_order and logs added on the item", () => {
    const { ctx, projectId, stateId } = setup();
    const item = insertWorkItem(ctx, projectId, stateId, "item");
    const seqBefore = latestSeq(ctx);
    const first = addLink(ctx, { work_item_id: item.id, url: " https://example.com/docs " });
    const second = addLink(ctx, { work_item_id: item.id, url: "https://example.com/2", title: "  Second  ", metadata: { kind: "pr", number: 12 } });
    expect(first).toMatchObject({
      parent_type: "work_item",
      work_item_id: item.id,
      module_id: null,
      title: "",
      url: "https://example.com/docs",
      metadata: null,
      created_by: ctx.actor.id,
      deleted_at: null,
    });
    expect(second).toMatchObject({ title: "Second", metadata: { kind: "pr", number: 12 } });
    expect(first.sort_order < second.sort_order).toBe(true);
    expect(listLinks(ctx, { work_item_id: item.id }).map((l) => l.id)).toEqual([first.id, second.id]);
    const rows = rowsSince(ctx, seqBefore);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      entity_type: "work_item",
      entity_id: item.id,
      work_item_id: item.id,
      project_id: projectId,
      verb: "added",
      field: "link",
      new_value: first.id,
      new_identifier: "https://example.com/docs",
    });
    expect(rows[1]).toMatchObject({ new_value: second.id, new_identifier: "Second" });
    expect(linkLabel(first)).toBe(first.url);
    expect(linkLabel(second)).toBe("Second");
  });

  it("adds a link to a module and logs added on the module", () => {
    const { ctx, projectId } = setup();
    const m = createModule(ctx, { project_id: projectId, name: "Auth" });
    const seqBefore = latestSeq(ctx);
    const link = addLink(ctx, { module_id: m.id, url: "https://example.com/spec", title: "Spec" });
    expect(link).toMatchObject({ parent_type: "module", module_id: m.id, work_item_id: null, title: "Spec" });
    expect(listLinks(ctx, { module_id: m.id }).map((l) => l.id)).toEqual([link.id]);
    const rows = rowsSince(ctx, seqBefore);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entity_type: "module",
      entity_id: m.id,
      work_item_id: null,
      project_id: projectId,
      verb: "added",
      field: "link",
      new_value: link.id,
      new_identifier: "Spec",
    });
  });

  it("requires exactly one parent", () => {
    const { ctx, projectId, stateId } = setup();
    const item = insertWorkItem(ctx, projectId, stateId, "item");
    const m = createModule(ctx, { project_id: projectId, name: "Auth" });
    expect(errorCode(() => addLink(ctx, { url: "https://example.com" }))).toBe("VALIDATION");
    expect(errorCode(() => addLink(ctx, { work_item_id: item.id, module_id: m.id, url: "https://example.com" }))).toBe("VALIDATION");
    expect(errorCode(() => addLink(ctx, { work_item_id: "nope", url: "https://example.com" }))).toBe("VALIDATION");
    expect(errorCode(() => addLink(ctx, { work_item_id: item.id, url: "https://example.com", extra: 1 } as never))).toBe("VALIDATION");
    expect(errorCode(() => listLinks(ctx, {}))).toBe("VALIDATION");
    expect(errorCode(() => listLinks(ctx, { work_item_id: item.id, module_id: m.id }))).toBe("VALIDATION");
    expect(listLinks(ctx, { work_item_id: item.id })).toEqual([]);
    expect(listLinks(ctx, { module_id: m.id })).toEqual([]);
  });

  it("accepts only absolute http(s) URLs", () => {
    const { ctx, projectId, stateId } = setup();
    const item = insertWorkItem(ctx, projectId, stateId, "item");
    const rejected = [
      "",
      " ",
      "example.com",
      "/relative/path",
      "ftp://example.com/file",
      "mailto:someone@example.com",
      "javascript:alert(1)",
      "http:example.com",
      "https:/example.com",
      "https://exa mple.com",
      "https://exa\nmple.com",
      "https://",
      `https://example.com/${"a".repeat(2100)}`,
    ];
    for (const url of rejected) {
      expect(errorCode(() => addLink(ctx, { work_item_id: item.id, url })), url).toBe("VALIDATION");
    }
    expect(listLinks(ctx, { work_item_id: item.id })).toEqual([]);
    const accepted = ["https://example.com", "http://localhost:3000/path?q=1#frag", "HTTPS://EXAMPLE.COM/Upper", " https://example.com/trimmed "];
    for (const url of accepted) {
      expect(addLink(ctx, { work_item_id: item.id, url }).url, url).toBe(url.trim());
    }
    expect(isHttpUrl("https://example.com")).toBe(true);
    expect(isHttpUrl("ftp://example.com")).toBe(false);
  });

  it("stores metadata through LinkMetadataSchema and reads unreadable metadata as null", () => {
    const { ctx, projectId, stateId } = setup();
    const item = insertWorkItem(ctx, projectId, stateId, "item");
    const link = addLink(ctx, { work_item_id: item.id, url: "https://example.com", metadata: { title: "Example", tags: ["a", "b"], nested: { ok: true } } });
    expect(getLink(ctx, link.id).metadata).toEqual({ title: "Example", tags: ["a", "b"], nested: { ok: true } });
    expect(errorCode(() => addLink(ctx, { work_item_id: item.id, url: "https://example.com", metadata: "text" as never }))).toBe("VALIDATION");
    ctx.db.update(work_item_link).set({ metadata: invalidMetadata() }).where(eq(work_item_link.id, link.id)).run();
    expect(getLink(ctx, link.id).metadata).toBeNull();
  });

  it("requires an existing, non-deleted parent", () => {
    const { ctx, projectId, stateId } = setup();
    expect(errorCode(() => addLink(ctx, { work_item_id: newId(), url: "https://example.com" }))).toBe("NOT_FOUND");
    expect(errorCode(() => addLink(ctx, { module_id: newId(), url: "https://example.com" }))).toBe("NOT_FOUND");
    expect(errorCode(() => listLinks(ctx, { work_item_id: newId() }))).toBe("NOT_FOUND");
    expect(errorCode(() => listLinks(ctx, { module_id: newId() }))).toBe("NOT_FOUND");
    const deleted = insertWorkItem(ctx, projectId, stateId, "deleted", { deleted_at: ctx.now() });
    expect(errorCode(() => addLink(ctx, { work_item_id: deleted.id, url: "https://example.com" }))).toBe("NOT_FOUND");
    expect(errorCode(() => listLinks(ctx, { work_item_id: deleted.id }))).toBe("NOT_FOUND");
  });
});

/** A JSON array is valid JSON but not a LinkMetadata record; written directly to simulate a foreign writer. */
function invalidMetadata(): never {
  return ["not", "a", "record"] as never;
}

describe("updateLink", () => {
  it("changes title, url and metadata with one activity row per changed field and nothing when unchanged", () => {
    const { ctx, projectId, stateId } = setup();
    const item = insertWorkItem(ctx, projectId, stateId, "item");
    const link = addLink(ctx, { work_item_id: item.id, url: "https://example.com/a", title: "A", metadata: { v: 1 } });
    const seqBefore = latestSeq(ctx);
    const updated = updateLink(ctx, link.id, { title: "B", url: "https://example.com/b", metadata: { v: 2 } });
    expect(updated).toMatchObject({ id: link.id, parent_type: "work_item", work_item_id: item.id, title: "B", url: "https://example.com/b", metadata: { v: 2 } });
    expect(updated.sort_order).toBe(link.sort_order);
    expect(updated.updated_at >= link.updated_at).toBe(true);
    const rows = rowsSince(ctx, seqBefore);
    expect(rows.every((r) => r.entity_type === "work_item" && r.entity_id === item.id && r.work_item_id === item.id && r.verb === "updated")).toBe(true);
    expect(rows.map((r) => r.field)).toEqual(["link_title", "link_url", "link_metadata"]);
    expect(rows[0]).toMatchObject({ old_value: "A", new_value: "B", old_identifier: "A", new_identifier: "B" });
    expect(rows[1]).toMatchObject({ old_value: "https://example.com/a", new_value: "https://example.com/b", old_identifier: "https://example.com/a" });
    expect(rows[2]).toMatchObject({ old_value: JSON.stringify({ v: 1 }), new_value: JSON.stringify({ v: 2 }), old_identifier: null, new_identifier: null });
    const seqAfter = latestSeq(ctx);
    expect(updateLink(ctx, link.id, { title: "B", url: "https://example.com/b" }).title).toBe("B");
    expect(updateLink(ctx, link.id, {}).url).toBe("https://example.com/b");
    expect(latestSeq(ctx)).toBe(seqAfter);
    const cleared = updateLink(ctx, link.id, { title: "", metadata: null });
    expect(cleared.title).toBe("");
    expect(cleared.metadata).toBeNull();
    expect(rowsSince(ctx, seqAfter).map((r) => [r.field, r.old_identifier, r.new_identifier])).toEqual([
      ["link_title", "B", null],
      ["link_metadata", null, null],
    ]);
  });

  it("works for module links and validates input", () => {
    const { ctx, projectId } = setup();
    const m = createModule(ctx, { project_id: projectId, name: "Auth" });
    const link = addLink(ctx, { module_id: m.id, url: "https://example.com" });
    const seqBefore = latestSeq(ctx);
    expect(updateLink(ctx, link.id, { title: "Spec" })).toMatchObject({ parent_type: "module", module_id: m.id, title: "Spec" });
    expect(rowsSince(ctx, seqBefore)).toHaveLength(1);
    expect(rowsSince(ctx, seqBefore)[0]).toMatchObject({ entity_type: "module", entity_id: m.id, field: "link_title", new_identifier: "Spec" });
    expect(errorCode(() => updateLink(ctx, link.id, { url: "" }))).toBe("VALIDATION");
    expect(errorCode(() => updateLink(ctx, link.id, { url: "example.com" }))).toBe("VALIDATION");
    expect(errorCode(() => updateLink(ctx, link.id, { module_id: m.id } as never))).toBe("VALIDATION");
    expect(errorCode(() => updateLink(ctx, newId(), { title: "x" }))).toBe("NOT_FOUND");
    expect(getLink(ctx, link.id).url).toBe("https://example.com");
  });
});

describe("removeLink", () => {
  it("soft-deletes, logs removed on the parent and is NOT_FOUND afterwards", () => {
    const { ctx, projectId, stateId } = setup();
    const item = insertWorkItem(ctx, projectId, stateId, "item");
    const m = createModule(ctx, { project_id: projectId, name: "Auth" });
    const itemLink = addLink(ctx, { work_item_id: item.id, url: "https://example.com/item", title: "Item link" });
    const keep = addLink(ctx, { work_item_id: item.id, url: "https://example.com/keep" });
    const moduleLink = addLink(ctx, { module_id: m.id, url: "https://example.com/module" });
    const seqBefore = latestSeq(ctx);
    removeLink(ctx, itemLink.id);
    removeLink(ctx, moduleLink.id);
    expect(listLinks(ctx, { work_item_id: item.id }).map((l) => l.id)).toEqual([keep.id]);
    expect(listLinks(ctx, { module_id: m.id })).toEqual([]);
    expect(errorCode(() => getLink(ctx, itemLink.id))).toBe("NOT_FOUND");
    expect(errorCode(() => removeLink(ctx, itemLink.id))).toBe("NOT_FOUND");
    expect(errorCode(() => updateLink(ctx, itemLink.id, { title: "x" }))).toBe("NOT_FOUND");
    expect(errorCode(() => removeLink(ctx, newId()))).toBe("NOT_FOUND");
    expect(ctx.db.select().from(work_item_link).where(eq(work_item_link.id, itemLink.id)).get()?.deleted_at).not.toBeNull();
    expect(ctx.db.select().from(module_link).where(eq(module_link.id, moduleLink.id)).get()?.deleted_at).not.toBeNull();
    const rows = rowsSince(ctx, seqBefore);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ entity_type: "work_item", entity_id: item.id, work_item_id: item.id, verb: "removed", field: "link", old_value: itemLink.id, old_identifier: "Item link" });
    expect(rows[1]).toMatchObject({ entity_type: "module", entity_id: m.id, work_item_id: null, verb: "removed", field: "link", old_value: moduleLink.id, old_identifier: "https://example.com/module" });
  });
});

describe("listLinks, getLink and countLinks", () => {
  it("lists the non-deleted links of one parent in sort order and keeps parents apart", () => {
    const { ctx, projectId, stateId } = setup();
    const one = insertWorkItem(ctx, projectId, stateId, "one");
    const two = insertWorkItem(ctx, projectId, stateId, "two");
    const m = createModule(ctx, { project_id: projectId, name: "Auth" });
    const a = addLink(ctx, { work_item_id: one.id, url: "https://example.com/a" });
    const b = addLink(ctx, { work_item_id: one.id, url: "https://example.com/b" });
    const c = addLink(ctx, { work_item_id: two.id, url: "https://example.com/c" });
    const d = addLink(ctx, { module_id: m.id, url: "https://example.com/d" });
    removeLink(ctx, b.id);
    const e = addLink(ctx, { work_item_id: one.id, url: "https://example.com/e" });
    expect(listLinks(ctx, { work_item_id: one.id }).map((l) => l.id)).toEqual([a.id, e.id]);
    expect(listLinks(ctx, { work_item_id: two.id }).map((l) => l.id)).toEqual([c.id]);
    expect(listLinks(ctx, { module_id: m.id }).map((l) => l.id)).toEqual([d.id]);
    expect(getLink(ctx, a.id).parent_type).toBe("work_item");
    expect(getLink(ctx, d.id).parent_type).toBe("module");
    const counts = countLinks(ctx, "work_item", [one.id, two.id]);
    expect(counts.get(one.id)).toBe(2);
    expect(counts.get(two.id)).toBe(1);
    const unknown = newId();
    expect(countLinks(ctx, "work_item", [unknown]).get(unknown)).toBe(0);
    expect(countLinks(ctx, "module", [m.id]).get(m.id)).toBe(1);
    expect(countLinks(ctx, "module", []).size).toBe(0);
  });
});

describe("archived parents", () => {
  it("an archived work item refuses add, update and remove with ARCHIVED while reads still work", () => {
    const { ctx, projectId, stateId } = setup();
    const item = insertWorkItem(ctx, projectId, stateId, "item");
    const link = addLink(ctx, { work_item_id: item.id, url: "https://example.com" });
    ctx.db.update(work_item).set({ archived_at: ctx.now() }).where(eq(work_item.id, item.id)).run();
    expect(errorCode(() => addLink(ctx, { work_item_id: item.id, url: "https://example.com/2" }))).toBe("ARCHIVED");
    expect(errorCode(() => updateLink(ctx, link.id, { title: "x" }))).toBe("ARCHIVED");
    expect(errorCode(() => removeLink(ctx, link.id))).toBe("ARCHIVED");
    expect(listLinks(ctx, { work_item_id: item.id }).map((l) => l.id)).toEqual([link.id]);
    expect(getLink(ctx, link.id).title).toBe("");
  });

  it("an archived module refuses add, update and remove with ARCHIVED", () => {
    const { ctx, projectId } = setup();
    const m = createModule(ctx, { project_id: projectId, name: "Auth", status: "completed" });
    const link = addLink(ctx, { module_id: m.id, url: "https://example.com" });
    archiveModule(ctx, m.id);
    expect(errorCode(() => addLink(ctx, { module_id: m.id, url: "https://example.com/2" }))).toBe("ARCHIVED");
    expect(errorCode(() => updateLink(ctx, link.id, { title: "x" }))).toBe("ARCHIVED");
    expect(errorCode(() => removeLink(ctx, link.id))).toBe("ARCHIVED");
    expect(listLinks(ctx, { module_id: m.id }).map((l) => l.id)).toEqual([link.id]);
  });

  it("an archived project refuses link mutations on both kinds of parent", () => {
    const { ctx, projectId, stateId } = setup();
    const item = insertWorkItem(ctx, projectId, stateId, "item");
    const m = createModule(ctx, { project_id: projectId, name: "Auth" });
    const itemLink = addLink(ctx, { work_item_id: item.id, url: "https://example.com/item" });
    const moduleLink = addLink(ctx, { module_id: m.id, url: "https://example.com/module" });
    archiveProject(ctx, projectId);
    expect(errorCode(() => addLink(ctx, { work_item_id: item.id, url: "https://example.com/2" }))).toBe("ARCHIVED");
    expect(errorCode(() => addLink(ctx, { module_id: m.id, url: "https://example.com/2" }))).toBe("ARCHIVED");
    expect(errorCode(() => updateLink(ctx, itemLink.id, { title: "x" }))).toBe("ARCHIVED");
    expect(errorCode(() => updateLink(ctx, moduleLink.id, { title: "x" }))).toBe("ARCHIVED");
    expect(errorCode(() => removeLink(ctx, itemLink.id))).toBe("ARCHIVED");
    expect(errorCode(() => removeLink(ctx, moduleLink.id))).toBe("ARCHIVED");
    expect(listLinks(ctx, { work_item_id: item.id })).toHaveLength(1);
    expect(listLinks(ctx, { module_id: m.id })).toHaveLength(1);
  });
});
