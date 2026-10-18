import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { createContext } from "@/lib/tessera/core/context";
import { TrackerError } from "@/lib/tessera/core/errors";
import { addQuickLink, listQuickLinks, removeQuickLink } from "@/lib/tessera/workspace";
import { createTestDb } from "../helpers/db";

function errorOf(fn: () => unknown): TrackerError | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof TrackerError) return err;
    throw err;
  }
  return undefined;
}

describe("quick links", () => {
  it("accepts http(s) and app paths and rejects anything else", () => {
    const handles = createTestDb();
    const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID });
    const external = addQuickLink(ctx, { url: "https://example.com" });
    const internal = addQuickLink(ctx, { url: "/projects", title: "All projects" });
    expect(listQuickLinks(ctx).map((link) => link.id)).toEqual([external.id, internal.id]);
    expect(external.title).toBe("");
    const rejected = errorOf(() => addQuickLink(ctx, { url: "javascript:alert(1)" }));
    expect(rejected?.code).toBe("VALIDATION");
    expect(errorOf(() => addQuickLink(ctx, { url: "ftp://files.example" }))?.code).toBe("VALIDATION");
    removeQuickLink(ctx, external.id);
    expect(listQuickLinks(ctx).map((link) => link.url)).toEqual(["/projects"]);
  });
});
