import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { USER_ACTOR_ID } from "@/lib/tessera/actors";
import { importHandbook, parseHandbookFile, planHandbookImport, type HandbookEntry } from "@/lib/tessera/import-handbook";
import { getPage, listPages } from "@/lib/tessera/pages";
import { createTestContext, createTestDb } from "./helpers/db";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "handbook");

function mustParse(file: string, text: string): HandbookEntry {
  const parsed = parseHandbookFile(file, text);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

function loadFixtures(): HandbookEntry[] {
  const files = fs.readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".md")).sort();
  expect(files).toHaveLength(12);
  return files.map((file) => mustParse(file, fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")));
}

describe("importHandbook", () => {
  it("imports the 12 handbook pages, rewrites item links, and skips them on a second run", () => {
    const ctx = createTestContext(createTestDb());
    const entries = loadFixtures();
    const result = importHandbook(ctx, entries);

    expect(result.created).toHaveLength(12);
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);

    const pages = listPages(ctx, { project_id: null });
    expect(pages.map((page) => page.name)).toEqual([
      "Getting started",
      "First week",
      "Setup",
      "Accounts",
      "Onboarding",
      "How we work",
      "Meetings",
      "Decisions",
      "Untitled collection",
      "YEah",
      "People",
      "Who does what",
    ]);
    expect(pages.filter((page) => page.parent_id === null).map((page) => page.name)).toEqual(["Getting started", "How we work", "People"]);

    const gettingStarted = pages.find((page) => page.name === "Getting started");
    const setup = pages.find((page) => page.name === "Setup");
    expect(gettingStarted).toBeDefined();
    expect(setup).toBeDefined();
    expect(pages.filter((page) => page.parent_id === gettingStarted?.id).map((page) => page.name)).toEqual(["First week", "Setup", "Onboarding"]);
    expect(pages.filter((page) => page.parent_id === setup?.id).map((page) => page.name)).toEqual(["Accounts"]);

    let pageLinks = 0;
    for (const summary of pages) {
      const detail = getPage(ctx, summary.id);
      expect(detail.description_md).not.toContain("](item:");
      for (const match of detail.description_md.matchAll(/\]\(page:([^)\s]+)\)/g)) {
        pageLinks += 1;
        expect(detail.embeds).toContainEqual({ entity_type: "page", entity_id: match[1] });
      }
    }
    expect(pageLinks).toBeGreaterThan(0);

    const yeah = pages.find((page) => page.name === "YEah");
    expect(yeah).toBeDefined();
    expect(getPage(ctx, yeah?.id ?? "").description_md).toBe("");

    const onboarding = pages.find((page) => page.name === "Onboarding");
    expect(getPage(ctx, onboarding?.id ?? "").updated_at).toBe("2026-10-09T17:11:31.743Z");
    expect(getPage(ctx, gettingStarted?.id ?? "").description_md.startsWith("The first pages a new teammate should read.\n\n")).toBe(true);

    const comments = ctx.sqlite
      .prepare(
        `SELECT comment, actor_id AS actorId FROM activity
         WHERE entity_type = 'page' AND verb = 'created' AND comment LIKE 'Imported from content/%'`,
      )
      .all() as { comment: string; actorId: string }[];
    expect(comments).toHaveLength(12);
    expect(comments.every((row) => row.actorId === USER_ACTOR_ID)).toBe(true);

    const again = importHandbook(ctx, entries);
    expect(again.created).toEqual([]);
    expect(again.skipped).toHaveLength(12);
    expect(listPages(ctx, { project_id: null })).toHaveLength(12);
  });

  it("warns and places a page at the top level when the parent is unknown", () => {
    const ctx = createTestContext(createTestDb());
    const accounts = loadFixtures().find((entry) => entry.slug === "accounts");
    expect(accounts).toBeDefined();
    const result = importHandbook(ctx, [{ ...accounts!, parent: "missing-parent" }]);
    expect(result.warnings.some((warning) => warning.includes("Unknown parent"))).toBe(true);
    const pages = listPages(ctx, { project_id: null });
    expect(pages).toHaveLength(1);
    expect(pages[0]?.name).toBe("Accounts");
    expect(pages[0]?.parent_id).toBeNull();
  });
});

describe("planHandbookImport", () => {
  it("warns on bad front matter, duplicate slugs, an unknown parent and an unknown link", () => {
    const alpha = mustParse(
      "alpha.md",
      ["---", "id: alpha", "title: Alpha", "kind: item", "parent:", "summary: Lead", "order: 2", "---", "", "Body.", ""].join("\n"),
    );
    const child = mustParse(
      "child.md",
      ["---", "id: child", "title: Child", "kind: item", "parent: nowhere", "summary:", "order: 1", "---", "", "See [Missing](item:missing).", ""].join("\n"),
    );
    const bad = parseHandbookFile("bad.md", "hello");
    const plan = planHandbookImport([alpha, { ...alpha, file: "alpha-copy.md" }, child, bad], new Set());

    expect(plan.skipped).toEqual([]);
    expect(plan.create.map((entry) => entry.slug)).toEqual(["child", "alpha"]);
    expect(plan.create[0]?.parent).toBeNull();
    const warnings = plan.warnings.join("\n");
    expect(warnings).toMatch(/Duplicate slug "alpha"/);
    expect(warnings).toMatch(/Unknown parent "nowhere"/);
    expect(warnings).toMatch(/Unknown item link "missing"/);
    expect(warnings).toMatch(/bad.md/);

    const skip = planHandbookImport([alpha], new Set(["alpha"]));
    expect(skip.create).toEqual([]);
    expect(skip.skipped).toEqual(["alpha"]);
  });
});
