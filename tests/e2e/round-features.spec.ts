import { createProjectViaMcp, expect, mcp, openWebWorkItems, openWorkItems, quickAddItems, test, waitForSaved } from "./fixtures";
import { inboxRows } from "./helpers-b";

/**
 * Browser checks for the features that the other lanes of fix round 2026-10-23
 * added (coalesced rows, mentions, the unread count, the `[[` trigger, assistant
 * Undo, phone rows). They run as ordinary tests and guard those features.
 *
 *   a, b, c  engine-notify  decisions 51, 53, 59 (coalesced rows, mentions, unread count in the poll)
 *   d        pages-editor   decision 10 (the `[[` page trigger)
 *   e        ai-undo        Undo on the "Applied" toast
 *   f        list           phone rows keep key and title on one line
 */

const USER_ACTOR_ID = "00000000-0000-7000-8000-000000000001";

type Item = { id: string; key: string; description_version?: number };

test.describe("notifications (engine-notify)", () => {
  test("two comments by one agent within 10 minutes make one inbox row reading 'commented 2 times'", async ({ page }) => {
    // The user creates the item in the UI, so the creator is subscribed and no agent call subscribes anyone:
    // an agent that assigned or subscribed the user first would coalesce into a higher-ranked or larger row.
    const project = await createProjectViaMcp();
    await openWorkItems(page, project.id);
    await quickAddItems(page, ["Watched by me"]);
    const item = await mcp<Item>("get_work_item_by_key", { key: `${project.identifier}-1` });

    const client = "e2e-notify";
    await mcp("create_comment", { work_item_id: item.id, body_md: "First thought" }, client);
    await mcp("create_comment", { work_item_id: item.id, body_md: "Second thought" }, client);

    await page.goto("/inbox");
    const rows = inboxRows(page).filter({ hasText: item.key });
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("commented 2 times");
    await expect(rows).not.toContainText("+1");
  });

  test("an agent mentioning the user in a description makes a 'mentioned you' row", async ({ page }) => {
    const project = await createProjectViaMcp();
    const client = "e2e-mention";
    const item = await mcp<Item>("create_work_item", { project_id: project.id, name: "Needs your eyes" }, client);
    await mcp(
      "update_work_item_description",
      { work_item_id: item.id, description_md: `Please review [@You](actor:${USER_ACTOR_ID}).`, expected_description_version: item.description_version ?? 0 },
      client,
    );

    await page.goto("/inbox");
    await expect(inboxRows(page).filter({ hasText: item.key })).toContainText("mentioned you");

    // The Mentions tab lists it too.
    await page.goto("/inbox?tab=mentions");
    await expect(inboxRows(page).filter({ hasText: item.key })).toContainText("mentioned you");
  });

  test("GET /api/changes returns a numeric unread_notifications", async ({ request }) => {
    const response = await request.get("/api/changes?since=0");
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { unread_notifications?: unknown };
    expect(typeof body.unread_notifications).toBe("number");
    expect(body.unread_notifications as number).toBeGreaterThanOrEqual(0);
  });

  test("unread_notifications moves by one when an agent comments on an item the user watches", async ({ page, request }) => {
    const unread = async () => ((await (await request.get("/api/changes?since=0")).json()) as { unread_notifications: number }).unread_notifications;
    const project = await createProjectViaMcp();
    await openWorkItems(page, project.id);
    await quickAddItems(page, ["Count me"]);
    const item = await mcp<Item>("get_work_item_by_key", { key: `${project.identifier}-1` });

    const before = await unread();
    await mcp("create_comment", { work_item_id: item.id, body_md: "Ping" }, "e2e-unread");
    expect(await unread()).toBe(before + 1);
  });
});

test.describe("page links (pages-editor)", () => {
  test("typing [[ offers pages and inserts a page link that survives a reload", async ({ page }) => {
    const project = await createProjectViaMcp();
    const target = await mcp<{ id: string }>("create_page", { project_id: project.id, name: "Zeta runbook" });
    const source = await mcp<{ id: string }>("create_page", { project_id: project.id, name: "Linking page" });

    await page.goto(`/projects/${project.id}/pages/${source.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Linking page" })).toBeVisible();
    // The editor mounts once the page has hydrated, a moment after the streamed title shows (decision 156);
    // until then the page's last textbox is the top bar's search field, which opens Power K on a key.
    const editor = page.getByRole("main").getByRole("textbox").last();
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await editor.click();
    await page.keyboard.type("See [[Zeta");

    const options = page.getByRole("listbox", { name: "Pages" });
    const option = options.getByRole("option", { name: /Zeta runbook/ });
    await expect(option).toBeVisible();
    await page.keyboard.press("Enter");

    // The link is `[Zeta runbook](page:<id>)` in Markdown: an anchor with a `page:` href and the page's name.
    const link = editor.locator('a[href^="page:"]');
    await expect(link).toHaveText("Zeta runbook");
    await expect(link).toHaveAttribute("href", `page:${target.id}`);
    await waitForSaved(page);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Linking page" }).first()).toBeVisible();
    const after = page.getByRole("main").getByRole("textbox").last().locator('a[href^="page:"]');
    await expect(after).toHaveText("Zeta runbook");
  });
});

test.describe("assistant undo (ai-undo)", () => {
  test("Apply, then Undo on the toast, puts the priority back", async ({ page }) => {
    // The fake client replays tests/e2e/fixtures/ai/undo-priority.json for this prompt. assistant.spec.ts
    // owns the identifier AIX, so this spec uses UNDO: the recording names the key UNDO-1.
    const project = await createProjectViaMcp("UNDO");
    const created = await mcp<{ id: string; key: string }>("create_work_item", { project_id: project.id, name: "Undo me" });
    expect(created.key).toBe("UNDO-1");

    await openWorkItems(page, project.id);
    await page.getByRole("button", { name: "Assistant", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "Assistant" });
    await expect(panel).toBeVisible();
    const composer = panel.getByRole("textbox");
    await composer.fill("Please raise the priority of UNDO-1 to urgent");
    await composer.press("Enter");

    await expect(panel.getByText("I proposed raising UNDO-1 to urgent.")).toBeVisible({ timeout: 20_000 });
    await panel.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(panel.getByText("Applied", { exact: true })).toBeVisible({ timeout: 20_000 });
    expect((await mcp<{ priority: string }>("get_work_item", { work_item_id: created.id })).priority).toBe("urgent");

    // The toast hides itself after 5 s: click Undo at once.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await mcp<{ priority: string }>("get_work_item", { work_item_id: created.id })).priority, { timeout: 15_000 }).toBe("none");
    // The toast text is repeated in Astryx's live region for screen readers, so two nodes match.
    await expect(page.getByText(/Undid 1 change/).first()).toBeVisible();
  });
});

test.describe("phone list rows (list)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("key and title share one line in every row at 375 px", async ({ page }) => {
    const rowsOnOneLine = async (): Promise<string[]> => {
      const rows = page.getByRole("listitem").filter({ has: page.getByRole("checkbox") });
      await expect(rows.first()).toBeVisible();
      return rows.evaluateAll((elements) => {
        const problems: string[] = [];
        for (const row of elements) {
          const key = row.querySelector<HTMLElement>(".tessera-wi-open");
          const title = row.querySelector<HTMLElement>(".tessera-wi-title");
          if (key === null || title === null) {
            problems.push(`${row.textContent?.slice(0, 30)}: no key or title element`);
            continue;
          }
          const keyBox = key.getBoundingClientRect();
          const titleBox = title.getBoundingClientRect();
          const lineHeight = parseFloat(getComputedStyle(title).lineHeight) || 20;
          const apart = Math.abs(keyBox.top + keyBox.height / 2 - (titleBox.top + titleBox.height / 2));
          const label = `${key.textContent?.trim()} ${title.textContent?.trim().slice(0, 24)}`;
          if (apart > 4) problems.push(`${label}: key and title centres ${Math.round(apart)} px apart`);
          if (titleBox.height > lineHeight * 1.5) problems.push(`${label}: title is ${Math.round(titleBox.height / lineHeight)} lines`);
        }
        return problems;
      });
    };

    // The seeded WEB project has 55 rows with labels, dates and assignees: the loaded rows are all checked.
    await openWebWorkItems(page);
    await expect(page.locator("[data-list-ready]").first()).toBeVisible({ timeout: 30_000 });
    expect(await rowsOnOneLine(), "WEB rows with key and title on separate lines").toEqual([]);

    // Titles that are far longer than the row cut to one line with an ellipsis.
    const project = await createProjectViaMcp();
    const long = "A deliberately very long work item title that would wrap onto several lines if it were allowed to";
    await mcp("create_work_item", { project_id: project.id, name: long, priority: "urgent", target_date: "2030-01-15" });
    await mcp("create_work_item", { project_id: project.id, name: "Unbroken".repeat(12) });
    await mcp("create_work_item", { project_id: project.id, name: "Short" });
    await openWorkItems(page, project.id);
    await expect(page.getByRole("listitem").filter({ hasText: "Short" })).toBeVisible();
    expect(await rowsOnOneLine(), "own rows with key and title on separate lines").toEqual([]);
  });
});
