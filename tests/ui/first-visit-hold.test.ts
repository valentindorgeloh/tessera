/**
 * The first-visit hold (decision 156, docs/contracts/ui.md "Reads"): the
 * covered pages have no Suspense boundary of their own and none above them, so
 * they block. A page-level fallback would commit a skeleton on a client
 * navigation and React 19.3 would hold the content for 300 ms; a boundary in
 * the frame put every page in a streamed segment that a full load revealed no
 * sooner than 300 ms after the first paint. The shape is read from source;
 * tests/e2e/first-visit-hold.spec.ts checks the behaviour in a browser.
 */
import { existsSync, readFileSync } from "node:fs";
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
  it("renders the page in the frame with no boundary around it", () => {
    const layout = source("app/(tessera)/layout.tsx");
    // The watchers' boundary closes, then the page sits directly in the shell.
    expect(layout).toMatch(/<\/Suspense>\s*\{children\}\s*<\/TesseraShell>/);
    expect(layout).not.toMatch(/\{children\}\s*<\/Suspense>/);
    expect(layout).not.toContain("PageSkeleton");
    expect(existsSync(path.join(process.cwd(), "src/components/shell/PageSkeleton.tsx"))).toBe(false);
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
