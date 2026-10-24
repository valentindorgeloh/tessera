/**
 * Shared Playwright fixtures and helpers (decision 123). Every spec imports
 * `test` and `expect` from here: its `page` fails the test on a page error or a
 * console error outside the field-guide tolerated list
 * (tolerated.ts); a test that expects other noise pushes onto `allowConsole`.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { isTolerated } from "./tolerated";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

type Fixtures = {
  /** Console messages the test accepts on top of the tolerated list; push a RegExp before the noise happens. */
  allowConsole: RegExp[];
};

export const test = base.extend<Fixtures>({
  allowConsole: async ({}, provide) => {
    // `provide`, not Playwright's usual `use`: react-hooks/rules-of-hooks reads `use(...)` as a React hook.
    await provide([]);
  },
  page: async ({ page, allowConsole }, provide) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await provide(page);
    const unexpected = errors.filter((text) => !isTolerated(text) && !allowConsole.some((pattern) => pattern.test(text)));
    expect(unexpected, "console errors").toEqual([]);
  },
});

export { expect };

/** Database the suite runs on (the webServer env sets the same). */
export function e2eDbPath(): string {
  return path.resolve(process.env.TESSERA_DB_PATH ?? path.join(REPO_ROOT, "data", "e2e.db"));
}

/**
 * Calls one Tessera tool over stdio the way an MCP client does: `npx tsx
 * scripts/mcp-call.ts` against the e2e database. Resolves with the parsed JSON
 * result and rejects with the tool's error text. `client` names the agent actor
 * (`mcp:<client>`).
 */
export async function mcp<T = Record<string, unknown>>(tool: string, input: Record<string, unknown> = {}, client = "e2e"): Promise<T> {
  try {
    const { stdout } = await execFileAsync("npx", ["tsx", "scripts/mcp-call.ts", "--client", client, tool, JSON.stringify(input)], {
      cwd: REPO_ROOT,
      env: { ...process.env, TESSERA_DB_PATH: e2eDbPath() },
      timeout: 120_000,
    });
    return JSON.parse(stdout) as T;
  } catch (err) {
    const failure = err as { stdout?: string; stderr?: string; message: string };
    throw new Error(`mcp ${tool} failed: ${failure.stdout || failure.stderr || failure.message}`);
  }
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
let counter = 0;
const issuedIdentifiers = new Set<string>();

/**
 * A project identifier no other spec uses: a letter prefix plus a process-unique suffix, all upper-case letters.
 * Only unique within the worker process: Playwright replaces the worker after a failing test, and the new one
 * starts with an empty set against the same data/e2e.db, so the project helpers below draw again on a CONFLICT.
 */
export function uniqueIdentifier(prefix = "E"): string {
  // The random tail alone collided about once in ten 280-project runs (birthday bound), so a taken identifier is drawn again.
  for (;;) {
    counter += 1;
    const tail = Array.from({ length: 3 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("");
    const identifier = `${prefix}${tail}${LETTERS[counter % 26]}`;
    if (!issuedIdentifiers.has(identifier)) {
      issuedIdentifiers.add(identifier);
      return identifier;
    }
  }
}

export type CreatedProject = { id: string; name: string; identifier: string };

const PROJECT_PATH = /\/projects\/([0-9a-f-]{20,})\/work-items/;

/** How many identifiers a project helper draws before a CONFLICT fails it. A caller's own identifier is never replaced. */
const IDENTIFIER_DRAWS = 5;

/** The id of the project whose pages are open. */
export function projectIdOf(page: Page): string {
  const match = page.url().match(/\/projects\/([0-9a-f-]{20,})/);
  expect(match?.[1], `project id in ${page.url()}`).toBeTruthy();
  return match![1]!;
}

/**
 * Creates a project through the sidebar dialog and lands on its work items. Without an `identifier` it draws one,
 * and draws again while the dialog says it (or the name made from it) is taken, at most `IDENTIFIER_DRAWS` times.
 */
export async function createProjectViaUi(page: Page, identifier?: string): Promise<CreatedProject> {
  await page.goto("/");
  await page.getByRole("button", { name: "Create project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await expect(dialog).toBeVisible();
  for (let draw = 1; ; draw += 1) {
    const candidate = identifier ?? uniqueIdentifier();
    const name = `Project ${candidate}`;
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Identifier").fill(candidate);
    await dialog.getByRole("button", { name: "Create project" }).click();
    // The dialog's inline CONFLICT texts name the candidate ("Identifier <id> is already used by project ...", "A project
    // named "Project <id>" already exists"), so the error left from the previous draw does not count for this one.
    const taken = dialog.getByText(new RegExp(`${candidate}.*(is already used|already exists)`));
    await expect
      .poll(async () => PROJECT_PATH.test(page.url()) || (await taken.count()) > 0, { message: `project ${candidate} created or refused`, timeout: 30_000 })
      .toBe(true);
    if (PROJECT_PATH.test(page.url())) {
      await page.waitForURL(PROJECT_PATH, { timeout: 30_000 });
      return { id: projectIdOf(page), name, identifier: candidate };
    }
    if (identifier !== undefined || draw >= IDENTIFIER_DRAWS) throw new Error(`createProjectViaUi: ${await taken.first().textContent()}`);
  }
}

/**
 * Creates a project over MCP: faster than the dialog and with no page needed. Without an `identifier` it draws one,
 * and draws again when `create_project` answers CONFLICT for it, at most `IDENTIFIER_DRAWS` times.
 */
export async function createProjectViaMcp(identifier?: string, extra: Record<string, unknown> = {}): Promise<CreatedProject> {
  for (let draw = 1; ; draw += 1) {
    const candidate = identifier ?? uniqueIdentifier();
    const name = `Project ${candidate}`;
    try {
      const project = await mcp<{ id: string }>("create_project", { name, identifier: candidate, ...extra });
      return { id: project.id, name, identifier: candidate };
    } catch (error) {
      // mcp() carries the tool's text: "CONFLICT: Identifier <id> is already used ..." or "CONFLICT: A project named "Project <id>" already exists".
      const taken = error instanceof Error && error.message.includes("CONFLICT: ") && error.message.includes(candidate);
      if (identifier !== undefined || !taken || draw >= IDENTIFIER_DRAWS) throw error;
    }
  }
}

/** Dialogs animate: let the open animation finish before the next step (field guide, 2 to 3 s). */
export async function waitForDialog(page: Page, name: string | RegExp): Promise<Locator> {
  const dialog = page.getByRole("dialog", { name }).or(page.getByRole("alertdialog", { name }));
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(700);
  return dialog;
}

/** Opens a project's work items and waits for the list marker. */
export async function openWorkItems(page: Page, projectId: string, query = ""): Promise<void> {
  await page.goto(`/projects/${projectId}/work-items${query}`);
  await expect(page.locator("[data-list-ready]").first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Pointer drag from the centre of `source` to the centre of `target` in small
 * steps, so the pointer-drag hooks (decision 105) see real move events.
 * `offset` moves the drop point away from the target's centre.
 */
export async function dragByPointer(
  page: Page,
  source: Locator,
  target: Locator,
  { offset = { x: 0, y: 0 }, steps = 12 }: { offset?: { x: number; y: number }; steps?: number } = {},
): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  expect(from, "drag source is on screen").not.toBeNull();
  expect(to, "drag target is on screen").not.toBeNull();
  const startX = from!.x + from!.width / 2;
  const startY = from!.y + from!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // A first small move crosses the drag threshold before the long travel.
  await page.mouse.move(startX + 6, startY + 6, { steps: 2 });
  await page.mouse.move(to!.x + to!.width / 2 + offset.x, to!.y + to!.height / 2 + offset.y, { steps });
  await page.waitForTimeout(120);
  await page.mouse.up();
}

/** Resolve the seeded WEB project to its UUID via the project index redirect. */
export async function openWebWorkItems(page: Page): Promise<string> {
  await page.goto("/projects/WEB");
  await page.waitForURL(PROJECT_PATH, { timeout: 30_000 });
  return projectIdOf(page);
}

type DisplayPatch = Record<string, unknown>;

/** `/projects/<id>/work-items` with a display patch in the `q` param (base64url JSON, url-state.ts), e.g. `{ layout: "board", group_by: "state" }`. */
export function workItemsUrl(projectId: string, display: DisplayPatch = {}, extra: Record<string, string> = {}, base = "work-items"): string {
  const params = new URLSearchParams(extra);
  if (Object.keys(display).length > 0) params.set("q", Buffer.from(JSON.stringify({ display })).toString("base64url"));
  const query = params.toString();
  return `/projects/${projectId}/${base}${query ? `?${query}` : ""}`;
}

/** Opens a project's work items in a layout grouped by state, waiting for the list marker. */
export async function openLayout(page: Page, projectId: string, layout: "list" | "board" | "table" | "calendar" | "gantt", display: DisplayPatch = {}): Promise<void> {
  await page.goto(workItemsUrl(projectId, { layout, group_by: "state", ...display }));
  // List, board and table carry the data-list-ready marker; calendar and gantt have their own root.
  const ready = layout === "calendar" ? ".tessera-cal" : layout === "gantt" ? ".tessera-gantt" : "[data-list-ready]";
  await expect(page.locator(ready).first()).toBeVisible({ timeout: 30_000 });
}

/** The board column of a state, found by its "Add a work item to <state>" button. */
export function boardColumn(page: Page, stateName: string): Locator {
  return page.locator(".tessera-board-column").filter({ has: page.getByRole("button", { name: `Add a work item to ${stateName}`, exact: true }) });
}

/** Adds items with the list's bottom quick-add row; the list must be open. */
export async function quickAddItems(page: Page, names: string[]): Promise<void> {
  await page.getByRole("button", { name: "New work item" }).last().click();
  const input = page.getByRole("textbox", { name: "New work item" });
  for (const name of names) {
    await input.fill(name);
    await page.keyboard.press("Enter");
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await page.keyboard.press("Escape");
}

/** The work item rows of the list layout. */
export function listRows(page: Page): Locator {
  return page.getByRole("listitem").filter({ has: page.getByRole("checkbox") });
}

/** Resolves when the next Server Action POST of the page has answered (a debounced save, a mutation). Create it before the step that triggers it. */
export function nextServerAction(page: Page): Promise<unknown> {
  return page.waitForResponse((response) => response.request().method() === "POST" && response.request().headers()["next-action"] !== undefined, { timeout: 15_000 });
}

/** After typing in a page or description editor: past the 400 ms debounce, the status reads Saved only once the write landed. */
export async function waitForSaved(page: Page): Promise<void> {
  await page.waitForTimeout(700);
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

/** Pointer drag from the centre of `source` by (dx, dy) pixels, in small steps (decision 105 hooks read real move events). */
export async function dragBy(page: Page, source: Locator, dx: number, dy = 0, { steps = 10, from }: { steps?: number; from?: "centre" | "left" | "right" } = {}): Promise<void> {
  // The gantt opens at its first day, so a bar can sit far off screen to the right.
  await source.scrollIntoViewIfNeeded();
  const box = await source.boundingBox();
  expect(box, "drag source is on screen").not.toBeNull();
  const startX = from === "left" ? box!.x + 2 : from === "right" ? box!.x + box!.width - 2 : box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + Math.sign(dx || 1) * 6, startY + (dy === 0 ? 0 : Math.sign(dy) * 6), { steps: 2 });
  await page.mouse.move(startX + dx, startY + dy, { steps });
  await page.waitForTimeout(120);
  await page.mouse.up();
}

/** Local calendar date `offset` days from today, as YYYY-MM-DD. */
export function isoDay(offset = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
