import { createProjectViaMcp, expect, mcp, openWorkItems, test } from "./fixtures";

/**
 * P5 with the fake client (decision 124): TESSERA_AI_FAKE replays
 * tests/e2e/fixtures/ai/raise-priority.json, so nothing reaches the Anthropic
 * API. The assistant only proposes; the work item changes on Apply.
 */

test("the assistant proposes a change, and writes nothing until Apply", async ({ page, request }) => {
  const status = await request.get("/api/ai/status");
  expect(await status.json()).toMatchObject({ available: true });

  // The recording names the key AIX-1, so the project identifier is fixed.
  const project = await createProjectViaMcp("AIX");
  const created = await mcp<{ id: string; key: string }>("create_work_item", { project_id: project.id, name: "Tune the thing" });
  expect(created.key).toBe("AIX-1");

  await openWorkItems(page, project.id);
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Assistant" });
  await expect(panel).toBeVisible();
  const composer = panel.getByRole("textbox");
  await composer.fill("Please raise the priority of AIX-1 to urgent");
  await composer.press("Enter");

  await expect(panel.getByText("I proposed raising AIX-1 to urgent.")).toBeVisible({ timeout: 20_000 });
  const apply = panel.getByRole("button", { name: "Apply", exact: true });
  await expect(apply).toBeVisible();

  // Nothing is written yet.
  const before = await mcp<{ priority: string }>("get_work_item", { work_item_id: created.id });
  expect(before.priority).toBe("none");

  await apply.click();
  await expect(panel.getByText("Applied", { exact: true })).toBeVisible({ timeout: 20_000 });
  const after = await mcp<{ priority: string }>("get_work_item", { work_item_id: created.id });
  expect(after.priority).toBe("urgent");
});
