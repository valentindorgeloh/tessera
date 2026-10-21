import { createProjectViaUi, expect, mcp, openWorkItems, quickAddItems, test } from "./fixtures";

/**
 * docs/PLAN.md §12 browser check 8 (subscribe, an MCP client comments, the inbox
 * badge counts it and mark read clears it) plus the P7 comment composer.
 */

test("a comment written in the peek is saved", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await quickAddItems(page, ["Discuss me"]);
  await page.getByRole("button", { name: `${project.identifier}-1`, exact: true }).click();
  const peek = page.getByRole("complementary", { name: "Work item" });
  await expect(peek.getByRole("heading", { name: "Discuss me" })).toBeVisible();

  await peek.getByRole("textbox").last().click();
  await page.keyboard.type("First comment from the browser");
  await peek.getByRole("button", { name: "Comment", exact: true }).click();
  // The composer clears once the action answers ok.
  await expect(peek.getByRole("textbox").last()).not.toContainText("First comment from the browser");

  const item = await mcp<{ id: string }>("get_work_item_by_key", { key: `${project.identifier}-1` });
  const comments = await mcp<{ items: { body_md: string; actor_name: string }[] }>("list_comments", { work_item_id: item.id });
  expect(comments.items.map((comment) => [comment.actor_name, comment.body_md])).toEqual([["You", "First comment from the browser"]]);
});

test("comments show in the peek's activity timeline", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await quickAddItems(page, ["Timeline item"]);
  await page.getByRole("button", { name: `${project.identifier}-1`, exact: true }).click();
  const peek = page.getByRole("complementary", { name: "Work item" });
  await expect(peek.getByRole("heading", { name: "Timeline item" })).toBeVisible();
  await peek.getByRole("textbox").last().click();
  await page.keyboard.type("Timeline comment from the browser");
  await peek.getByRole("button", { name: "Comment", exact: true }).click();

  const activity = peek.getByRole("list", { name: "Activity" });
  await expect(activity).toContainText("Timeline comment from the browser", { timeout: 15_000 });

  const item = await mcp<{ id: string }>("get_work_item_by_key", { key: `${project.identifier}-1` });
  await mcp("create_comment", { work_item_id: item.id, body_md: "Timeline comment from an agent" });

  await page.reload();
  const reloaded = page.getByRole("complementary", { name: "Work item" }).or(page.getByRole("main"));
  await expect(reloaded.getByRole("list", { name: "Activity" }).first()).toContainText("Timeline comment from the browser");
  await expect(reloaded.getByRole("list", { name: "Activity" }).first()).toContainText("Timeline comment from an agent");

  await reloaded.getByRole("radio", { name: "Comments" }).first().click();
  await expect(reloaded.getByRole("list", { name: "Activity" }).first()).toContainText("Timeline comment from the browser");
});

test("a subscribed item's MCP comment raises the inbox badge, and opening it marks it read", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await quickAddItems(page, ["Watch me"]);
  await page.getByRole("button", { name: `${project.identifier}-1`, exact: true }).click();
  const peek = page.getByRole("complementary", { name: "Work item" });
  await expect(peek.getByRole("heading", { name: "Watch me" })).toBeVisible();
  // The creator is subscribed already; subscribe only when the button still offers it.
  const subscribe = peek.getByRole("button", { name: "Subscribe", exact: true });
  if (await subscribe.isVisible()) await subscribe.click();
  await expect(peek.getByRole("button", { name: "Unsubscribe" })).toBeVisible();

  const inboxLink = page.getByRole("navigation", { name: "Work" }).getByRole("link", { name: /^Inbox/ });
  const unreadBefore = Number(((await inboxLink.textContent()) ?? "").replace(/\D/g, "") || "0");

  const item = await mcp<{ id: string }>("get_work_item_by_key", { key: `${project.identifier}-1` });
  await mcp("create_comment", { work_item_id: item.id, body_md: "Agent comment for the inbox" });
  await expect(inboxLink).toContainText(String(unreadBefore + 1), { timeout: 20_000 });

  await inboxLink.click();
  await page.waitForURL(/\/inbox/);
  const row = page.getByRole("list", { name: "Notifications" }).getByRole("listitem").first();
  await expect(row).toContainText(`${project.identifier}-1`);
  await row.click();
  await expect(page.getByRole("heading", { name: "Watch me" }).first()).toBeVisible();
  await expect(inboxLink).not.toContainText(String(unreadBefore + 1), { timeout: 15_000 });
});
