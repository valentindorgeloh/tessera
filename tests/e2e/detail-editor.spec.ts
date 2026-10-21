import { createProjectViaUi, expect, mcp, openWorkItems, quickAddItems, test } from "./fixtures";

/**
 * docs/PLAN.md §12 browser check 5 (description saved by the pagehide beacon)
 * and the editor's "Updated elsewhere" Banner (check 6, dirty-editor half).
 */

async function openFirstItemPeek(page: import("@playwright/test").Page, name: string) {
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await quickAddItems(page, [name]);
  await page.getByRole("button", { name: `${project.identifier}-1`, exact: true }).click();
  const peek = page.getByRole("complementary", { name: "Work item" });
  await expect(peek.getByRole("heading", { name })).toBeVisible();
  return { project, peek };
}

test("a description typed just before a reload is persisted", async ({ page }) => {
  const { peek } = await openFirstItemPeek(page, "Describe me");
  const editor = peek.getByRole("textbox").first();
  await editor.click();
  await page.keyboard.type("Typed right before the reload");
  // No wait: the reload lands inside the 400 ms debounce and the pagehide beacon has to carry the text.
  await page.reload();
  const reloaded = page.getByRole("complementary", { name: "Work item" }).getByRole("textbox").first();
  await expect(reloaded).toContainText("Typed right before the reload", { timeout: 15_000 });
});

test("an MCP description write shows the Updated elsewhere banner in a focused editor", async ({ page }) => {
  const { project, peek } = await openFirstItemPeek(page, "Banner item");
  const item = await mcp<{ id: string }>("get_work_item_by_key", { key: `${project.identifier}-1` });
  const itemId = item.id;

  const editor = peek.getByRole("textbox").first();
  await editor.click();
  await page.keyboard.type("Local draft");
  await expect(peek.getByText("Saved")).toBeVisible({ timeout: 10_000 });
  const detail = await mcp<{ description_version: number }>("get_work_item", { work_item_id: itemId });
  await mcp("update_work_item_description", {
    work_item_id: itemId,
    description_md: "Written by an agent",
    expected_description_version: detail.description_version,
  });
  // The editor still has focus and local text: the poller (about 5 s) offers the new text instead of replacing it.
  await page.keyboard.type(" and more");
  await expect(page.getByText("Updated elsewhere").or(page.getByText("Changed elsewhere"))).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Load theirs" }).click();
  await expect(peek.getByRole("textbox").first()).toContainText("Written by an agent");
});
