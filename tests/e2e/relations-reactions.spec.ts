import { createProjectViaUi, expect, mcp, openWorkItems, quickAddItems, test, waitForDialog } from "./fixtures";

/**
 * The Relations section and the reactions on the work item detail (decisions 55
 * and 57), driven through the peek: add a blocked-by relation and see it from
 * both items, react to the description and to a comment, reload, and find
 * every one of them still there.
 */

test("a blocked-by relation added in the peek shows on both items", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await quickAddItems(page, ["Blocked item", "Blocker item"]);
  await page.getByRole("button", { name: `${project.identifier}-1`, exact: true }).click();
  const peek = page.getByRole("complementary", { name: "Work item" });
  await expect(peek.getByRole("heading", { name: "Blocked item" })).toBeVisible();

  await peek.getByRole("button", { name: "Add relation", exact: true }).click();
  const dialog = await waitForDialog(page, "Add relation");
  await dialog.getByRole("combobox", { name: /Relation type/ }).click();
  await page.getByRole("option", { name: "Blocked by", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Work item" }).fill("Blocker item");
  await dialog.getByRole("button", { name: /Blocker item/ }).click();
  await expect(page.getByRole("dialog", { name: "Add relation" })).toBeHidden();

  // From the open item's side: it is blocked by the other one.
  const blockedBy = peek.getByRole("list", { name: "Blocked by" });
  await expect(blockedBy).toContainText(`${project.identifier}-2`);
  await expect(blockedBy).toContainText("Blocker item");

  // The stored relation reads as blocking from the other side, and the peek shows it there.
  const blocker = await mcp<{ id: string }>("get_work_item_by_key", { key: `${project.identifier}-2` });
  const relations = await mcp<{ result: { relation_type: string }[] }>("list_relations", { work_item_id: blocker.id });
  expect(relations.result.map((row) => row.relation_type)).toEqual(["blocking"]);

  await blockedBy.getByRole("button", { name: `${project.identifier}-2`, exact: true }).click();
  await expect(peek.getByRole("heading", { name: "Blocker item" })).toBeVisible();
  const blocking = peek.getByRole("list", { name: "Blocking" });
  await expect(blocking).toContainText(`${project.identifier}-1`);
  await expect(blocking).toContainText("Blocked item");

  // Reload keeps it, and removing it from this side clears it on both.
  await page.reload();
  await expect(peek.getByRole("list", { name: "Blocking" })).toContainText(`${project.identifier}-1`);
  await peek.getByRole("button", { name: `Remove relation to ${project.identifier}-1` }).click();
  await expect(peek.getByRole("list", { name: "Blocking" })).toHaveCount(0);
  await page.reload();
  await expect(peek.getByRole("heading", { name: "Blocker item" })).toBeVisible();
  await expect(peek.getByRole("list", { name: "Blocking" })).toHaveCount(0);
});

test("reactions on the description and on a comment survive a reload", async ({ page }) => {
  const project = await createProjectViaUi(page);
  await openWorkItems(page, project.id);
  await quickAddItems(page, ["React to me"]);
  const item = await mcp<{ id: string }>("get_work_item_by_key", { key: `${project.identifier}-1` });
  await mcp("create_comment", { work_item_id: item.id, body_md: "Worth a thumbs up" });
  await page.reload();

  await page.getByRole("button", { name: `${project.identifier}-1`, exact: true }).click();
  const peek = page.getByRole("complementary", { name: "Work item" });
  await expect(peek.getByRole("heading", { name: "React to me" })).toBeVisible();
  await expect(peek.getByText("Worth a thumbs up")).toBeVisible();

  // The description: open the picker, pick the thumbs up.
  const onDescription = peek.getByRole("group", { name: "Reactions to the description" });
  await onDescription.getByRole("button", { name: "Add reaction" }).click();
  await page.getByRole("button", { name: "React with thumbs up" }).click();
  await expect(onDescription.getByRole("button", { name: "thumbs up reaction, 1" })).toHaveAttribute("aria-pressed", "true");

  // The comment gets its own.
  const onComment = peek.getByRole("group", { name: /^Reactions to the comment by/ });
  await onComment.getByRole("button", { name: "Add reaction" }).click();
  await page.getByRole("button", { name: "React with thumbs up" }).click();
  await expect(onComment.getByRole("button", { name: "thumbs up reaction, 1" })).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  const reloaded = page.getByRole("complementary", { name: "Work item" });
  await expect(reloaded.getByRole("group", { name: "Reactions to the description" }).getByRole("button", { name: "thumbs up reaction, 1" })).toHaveAttribute("aria-pressed", "true");
  await expect(reloaded.getByRole("group", { name: /^Reactions to the comment by/ }).getByRole("button", { name: "thumbs up reaction, 1" })).toHaveAttribute("aria-pressed", "true");

  // Clicking the chip again takes the reaction back.
  await reloaded.getByRole("group", { name: "Reactions to the description" }).getByRole("button", { name: "thumbs up reaction, 1" }).click();
  await expect(reloaded.getByRole("group", { name: "Reactions to the description" }).getByRole("button", { name: /thumbs up reaction/ })).toHaveCount(0);
});
