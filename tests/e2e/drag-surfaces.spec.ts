import { createProjectViaMcp, dragByPointer, expect, mcp, test, uniqueIdentifier, waitForDialog, type CreatedProject } from "./fixtures";

/**
 * The reorder surfaces of decision 105 (views, states, labels, pages, stickies,
 * quick links, Home widgets). Every surface keeps a keyboard path (decision 14),
 * and those tests are active: a row menu's Move up / Move earlier / Move left
 * writes the new order, which is read back over MCP. The pointer drags are
 * active too and read the saved order back the same way.
 */

type Listed<T> = { items?: T[]; result?: T[] };
type Named = { id: string; name: string; state_group?: string };

async function names(tool: string, input: Record<string, unknown>, only?: (row: Named) => boolean): Promise<string[]> {
  const listed = await mcp<Listed<Named>>(tool, input);
  const rows = listed.items ?? listed.result ?? [];
  return rows.filter((row) => (only ? only(row) : true)).map((row) => row.name);
}

test.describe("reorder surfaces", () => {
  let project: CreatedProject;
  const suffix = uniqueIdentifier("S");

  test.beforeAll(async () => {
    project = await createProjectViaMcp();
    for (const name of ["View A", "View B"]) await mcp("create_view", { project_id: project.id, name });
    for (const name of ["Review", "QA"]) await mcp("create_state", { project_id: project.id, name, state_group: "started" });
    for (const name of ["L1", "L2"]) await mcp("create_label", { project_id: project.id, name });
    for (const name of ["P1", "P2"]) await mcp("create_page", { project_id: project.id, name });
  });

  test("views: a row menu's Move up swaps the saved order", async ({ page }) => {
    await page.goto(`/projects/${project.id}/views`);
    const row = page.getByRole("listitem").filter({ hasText: "View B" });
    await row.getByRole("button", { name: "View actions" }).click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await expect.poll(() => names("list_views", { project_id: project.id }), { timeout: 15_000 }).toEqual(["View B", "View A"]);
  });

  test("states: Move up reorders within the group", async ({ page }) => {
    await page.goto(`/projects/${project.id}/settings/states`);
    const row = page.getByRole("listitem").filter({ hasText: "QA" });
    await row.getByRole("button", { name: "Actions for QA" }).click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    const started = (row: Named) => row.state_group === "started";
    await expect.poll(() => names("list_states", { project_id: project.id }, started), { timeout: 15_000 }).toEqual(["In Progress", "QA", "Review"]);
  });

  test("labels: Move up reorders the labels", async ({ page }) => {
    await page.goto(`/projects/${project.id}/settings/labels`);
    const row = page.getByRole("listitem").filter({ hasText: "L2" });
    await row.getByRole("button", { name: "Actions for L2" }).click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await expect.poll(() => names("list_labels", { project_id: project.id }), { timeout: 15_000 }).toEqual(["L2", "L1"]);
  });

  test("pages: the tree row menu's Move up reorders siblings", async ({ page }) => {
    await page.goto(`/projects/${project.id}/pages`);
    const row = page.getByRole("treeitem").filter({ hasText: "P2" });
    await row.getByRole("button", { name: "Page actions" }).click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await expect.poll(() => names("list_pages", { project_id: project.id }), { timeout: 15_000 }).toEqual(["P2", "P1"]);
  });

  test("quick links: Move left puts a link before its neighbour", async ({ page }) => {
    const first = `First ${suffix}`;
    const second = `Second ${suffix}`;
    await mcp("add_quick_link", { url: "/analytics", title: first });
    await mcp("add_quick_link", { url: "/stickies", title: second });
    const order = async () => {
      const listed = await mcp<Listed<{ title: string }>>("list_quick_links");
      return (listed.items ?? listed.result ?? []).map((link) => link.title).filter((title) => title === first || title === second);
    };
    expect(await order()).toEqual([first, second]);

    await page.goto("/");
    await page.getByRole("button", { name: `Actions for ${second}` }).click();
    await page.getByRole("menuitem", { name: "Move left" }).click();
    await expect.poll(order, { timeout: 15_000 }).toEqual([second, first]);
  });

  test("Home widgets: Manage widgets' Reorder menu moves a widget down, and Save keeps it", async ({ page }) => {
    await page.goto("/");
    const labels = async () => {
      const dialog = await waitForDialog(page, "Manage widgets");
      return dialog.getByRole("listitem").allTextContents();
    };
    const open = async () => {
      await page.getByRole("button", { name: "Home actions" }).click();
      await page.getByRole("menuitem", { name: "Manage widgets…" }).click();
    };

    await open();
    const before = await labels();
    const dialog = page.getByRole("dialog", { name: "Manage widgets" });
    const first = before[0]!.replace(/\s+/g, " ").trim();
    await dialog.getByRole("button", { name: /^Reorder / }).first().click();
    await page.getByRole("menuitem", { name: "Move down" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    await open();
    const after = await labels();
    expect(after[1]).toContain(first.split(" ")[0]!);
    expect(after[0]).not.toBe(before[0]);

    // Put the order back: the first row's twin moves up again.
    await dialog.getByRole("button", { name: /^Reorder / }).nth(1).click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
  });

  test("stickies: a card menu's Move earlier reorders the grid", async ({ page }) => {
    const older = `Older ${suffix}`;
    const newer = `Newer ${suffix}`;
    await mcp("create_sticky", { name: older });
    await mcp("create_sticky", { name: newer });
    const order = async () => {
      const listed = await mcp<Listed<{ name: string }>>("list_stickies");
      return (listed.items ?? listed.result ?? []).map((sticky) => sticky.name).filter((name) => name === older || name === newer);
    };
    expect(await order()).toEqual([newer, older]);

    await page.goto("/stickies");
    await page.getByRole("button", { name: `Actions for ${older}` }).click();
    await page.getByRole("menuitem", { name: "Move earlier" }).click();
    await expect.poll(order, { timeout: 15_000 }).toEqual([older, newer]);
  });

  test.describe("pointer drags", () => {
    test("views: a row dragged above another saves the order", async ({ page }) => {
      await page.goto(`/projects/${project.id}/views`);
      await dragByPointer(page, page.getByRole("listitem").filter({ hasText: "View B" }), page.getByRole("listitem").filter({ hasText: "View A" }), { offset: { x: 0, y: -8 } });
      await expect.poll(() => names("list_views", { project_id: project.id })).toEqual(["View B", "View A"]);
    });

    test("states: a row dragged above another in its group saves the order", async ({ page }) => {
      await page.goto(`/projects/${project.id}/settings/states`);
      await dragByPointer(page, page.getByRole("listitem").filter({ hasText: "QA" }), page.getByRole("listitem").filter({ hasText: "Review" }), { offset: { x: 0, y: -8 } });
      await expect.poll(() => names("list_states", { project_id: project.id }, (row) => row.state_group === "started")).toEqual(["In Progress", "QA", "Review"]);
    });

    test("labels: a row dragged above another saves the order", async ({ page }) => {
      await page.goto(`/projects/${project.id}/settings/labels`);
      await dragByPointer(page, page.getByRole("listitem").filter({ hasText: "L2" }), page.getByRole("listitem").filter({ hasText: "L1" }), { offset: { x: 0, y: -8 } });
      await expect.poll(() => names("list_labels", { project_id: project.id })).toEqual(["L2", "L1"]);
    });

    test("pages: a tree row dragged above another reorders the siblings", async ({ page }) => {
      await page.goto(`/projects/${project.id}/pages`);
      await dragByPointer(page, page.getByRole("treeitem").filter({ hasText: "P2" }), page.getByRole("treeitem").filter({ hasText: "P1" }), { offset: { x: 0, y: -8 } });
      await expect.poll(() => names("list_pages", { project_id: project.id })).toEqual(["P2", "P1"]);
    });

    test("stickies: a card dragged before another reorders the grid", async ({ page }) => {
      const older = `DragOlder ${suffix}`;
      const newer = `DragNewer ${suffix}`;
      await mcp("create_sticky", { name: older });
      await mcp("create_sticky", { name: newer });
      const order = async () => {
        const listed = await mcp<Listed<{ name: string }>>("list_stickies");
        return (listed.items ?? listed.result ?? []).map((sticky) => sticky.name).filter((name) => name === older || name === newer);
      };
      expect(await order()).toEqual([newer, older]);

      await page.goto("/stickies");
      await dragByPointer(page, page.getByRole("button", { name: `Reorder ${older}` }), page.getByRole("button", { name: `Reorder ${newer}` }), { offset: { x: -8, y: 0 } });
      await expect.poll(order, { timeout: 15_000 }).toEqual([older, newer]);
    });

    test("quick links: a chip dragged before another reorders the links", async ({ page }) => {
      const first = `DragFirst ${suffix}`;
      const second = `DragSecond ${suffix}`;
      await mcp("add_quick_link", { url: "/analytics", title: first });
      await mcp("add_quick_link", { url: "/stickies", title: second });
      const order = async () => {
        const listed = await mcp<Listed<{ title: string }>>("list_quick_links");
        return (listed.items ?? listed.result ?? []).map((link) => link.title).filter((title) => title === first || title === second);
      };
      expect(await order()).toEqual([first, second]);

      await page.goto("/");
      const chip = (title: string) => page.locator(".tessera-quick-link").filter({ hasText: title });
      // Home streams in: while it does, a hidden copy of each chip sits beside the live one, so wait for one chip each.
      await expect(chip(second)).toHaveCount(1);
      await expect(chip(first)).toHaveCount(1);
      await expect(chip(second)).toBeVisible();
      await dragByPointer(page, chip(second), chip(first), { offset: { x: -8, y: 0 } });
      await expect.poll(order, { timeout: 15_000 }).toEqual([second, first]);
    });

    test("Home widgets: a widget row dragged above another reorders the widgets", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Home actions" }).click();
      await page.getByRole("menuitem", { name: "Manage widgets…" }).click();
      const dialog = await waitForDialog(page, "Manage widgets");
      const rows = dialog.getByRole("listitem");
      const text = async (index: number) => ((await rows.nth(index).textContent()) ?? "").replace(/\s+/g, " ").trim();
      const [first, second] = [await text(0), await text(1)];
      expect(first).not.toBe(second);
      await dragByPointer(page, rows.nth(1), rows.nth(0), { offset: { x: 0, y: -8 } });
      await expect.poll(() => text(0)).toBe(second);
      await expect.poll(() => text(1)).toBe(first);
    });
  });
});
