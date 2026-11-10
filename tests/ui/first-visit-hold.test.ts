/**
 * The first-visit hold (decision 156, docs/contracts/ui.md "Reads"): the page
 * area has ONE boundary, in the frame, and the covered pages have none of their
 * own. A page-level fallback would commit a skeleton on a client navigation and
 * React 19.3 would hold the content for 300 ms. The shape is read from source;
 * tests/e2e/first-visit-hold.spec.ts checks the behaviour in a browser.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(path.join(process.cwd(), "src", file), "utf8");
}

const HELD_PAGES = [
  "app/(tessera)/analytics/[tab]/page.tsx",
  "app/(tessera)/inbox/page.tsx",
  "app/(tessera)/wiki/page.tsx",
  "app/(tessera)/projects/[projectId]/cycles/page.tsx",
  "app/(tessera)/projects/[projectId]/cycles/[cycleId]/page.tsx",
  "app/(tessera)/projects/[projectId]/work-items/page.tsx",
  // The redirect behind a `cycle:<id>` link: same hold, so the old page stays until the redirect resolves.
  "app/(tessera)/cycles/[cycleId]/page.tsx",
] as const;

describe("first-visit hold", () => {
  it("puts the page boundary in the frame, with PageSkeleton, around the children", () => {
    const layout = source("app/(tessera)/layout.tsx");
    expect(layout).toContain('import { PageSkeleton } from "@/components/shell/PageSkeleton"');
    expect(layout).toMatch(/<Suspense fallback=\{<PageSkeleton \/>\}>\s*\{children\}\s*<\/Suspense>/);
  });

  it("draws PageSkeleton from tokens, with the label a browser check looks for", () => {
    const skeleton = source("components/shell/PageSkeleton.tsx");
    expect(skeleton).toContain('aria-label="Loading page"');
    expect(skeleton).not.toMatch(/(?:width|height)=\{\d+\}/);
  });

  it.each(HELD_PAGES)("%s opts out of the instant check and has no page-level Suspense", (file) => {
    const page = source(file);
    expect(page).toMatch(/^export const instant = false;$/m);
    // The inbox keeps one inner boundary, for the selected item (checked below).
    const allowed = file === "app/(tessera)/inbox/page.tsx" ? 1 : 0;
    expect(page.match(/<Suspense\b/g)?.length ?? 0).toBe(allowed);
  });

  it("keeps the inbox's selected item and the project layout's opt-out", () => {
    // A separate part that streams under the list: its own boundary stays.
    expect(source("app/(tessera)/inbox/page.tsx")).toMatch(/<Suspense fallback=\{<DetailSkeleton \/>\}>/);
    const project = source("app/(tessera)/projects/[projectId]/layout.tsx");
    expect(project).toMatch(/^export const instant = false;$/m);
    expect(project).not.toMatch(/<Suspense\b/);
  });
});
