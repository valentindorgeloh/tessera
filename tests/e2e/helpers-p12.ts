/**
 * Helpers for the sidebar views, layout motion, virtual list and calendar zoom
 * specs (sidebar, motion, virtual-scroll, virtual-perf, calendar-zoom). Like
 * helpers-a..d they import from `fixtures.ts` only and change no other helper
 * file. Constants come from their source modules, never copied.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Locator, Page } from "@playwright/test";
import { BOARD_GROUP_PAGE, ROW_PAGE, showMoreLabel } from "@/components/work-items/paging";
import { ESTIMATE, OVERSCAN, VIRTUAL_BOARD_MIN, VIRTUAL_GANTT_MIN, VIRTUAL_LIST_MIN, VIRTUAL_TABLE_MIN } from "@/components/virtual/virtual-config";
import { e2eDbPath, mcp } from "./fixtures";

export { BOARD_GROUP_PAGE, ESTIMATE, OVERSCAN, ROW_PAGE, showMoreLabel, VIRTUAL_BOARD_MIN, VIRTUAL_GANTT_MIN, VIRTUAL_LIST_MIN, VIRTUAL_TABLE_MIN };

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Seeds a perf project of `items` items into the e2e database (`scripts/perf-seed.ts --projects 0`), named
 * "Performance <identifier>". perf-db refuses the path TESSERA_DB_PATH names, so the child runs without it and
 * gets the database as `--db`. Idempotent per identifier. Resolves the new project's id with `list_projects`.
 */
export async function seedPerfProject(identifier: string, items: number): Promise<{ id: string; identifier: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.TESSERA_DB_PATH;
  try {
    await execFileAsync("npx", ["tsx", "scripts/perf-seed.ts", "--db", e2eDbPath(), "--items", String(items), "--projects", "0", "--project", identifier], {
      cwd: REPO_ROOT,
      env,
      timeout: 120_000,
    });
  } catch (err) {
    const failure = err as { stdout?: string; stderr?: string; message: string };
    throw new Error(`perf-seed ${identifier} failed: ${failure.stderr || failure.stdout || failure.message}`);
  }
  const listed = await mcp<{ items: { id: string; identifier: string }[] }>("list_projects");
  const project = listed.items.find((row) => row.identifier === identifier);
  if (project === undefined) throw new Error(`seedPerfProject: ${identifier} is not in list_projects`);
  return { id: project.id, identifier };
}

/** Archives a project, so it leaves the default lists (the sidebar, Your work, analytics) for the specs that run later. */
export async function archiveProject(id: string): Promise<void> {
  await mcp("archive_project", { project_id: id });
}

/**
 * The work-items scroller of the visible route. Next keeps left routes mounted under a hidden `<Activity>`, so a
 * document-wide query can hit a hidden copy; every row count and row locator of these specs is scoped inside this.
 * In `page.evaluate` use `visibleScrollerSource` instead.
 */
export function visibleScroller(page: Page): Locator {
  return page.locator(".tessera-wi-scroller:visible");
}

/** The same scroller inside the page: `(${visibleScrollerSource})()` is the element or undefined. */
export const visibleScrollerSource = `() => [...document.querySelectorAll(".tessera-wi-scroller")].find((el) => el.offsetParent !== null)`;

/** Decision 138's rendered-row caps; the only copy of them. */
export const MAX_RENDERED = { list: 40, table: 40, gantt: 56, board: 12 } as const;

export type RowBox = { top: number; bottom: number };

/** The rendered rows matching `selector` inside `scroller`, top and bottom in viewport pixels, in DOM order. */
export async function rowBoxes(scroller: Locator, selector: string): Promise<RowBox[]> {
  return scroller.evaluate(
    (root, sel) =>
      [...root.querySelectorAll(sel)].map((row) => {
        const box = row.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      }),
    selector,
  );
}

export type StoredNavPrefs = { display?: string; rail?: string; dock?: string };

/** The parsed `localStorage["tessera.nav.v1"]`; null when nothing is stored. */
export async function navPrefs(page: Page): Promise<StoredNavPrefs | null> {
  const raw = await page.evaluate(() => {
    try {
      return window.localStorage.getItem("tessera.nav.v1");
    } catch {
      return null;
    }
  });
  return raw === null ? null : (JSON.parse(raw) as StoredNavPrefs);
}
