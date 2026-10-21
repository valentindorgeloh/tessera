import { createProjectViaMcp, expect, mcp, openWebWorkItems, test } from "./fixtures";

/**
 * Two-scheme smoke (decision 123): with the preference "Match system" (the app
 * defaults to Frappe dark, so the test stores "system" first), emulating dark
 * and light must give two different page backgrounds and leave the console
 * clean. It stays a smoke: contrast is checked by the theme unit tests.
 */

/** The body background once the scheme has settled (the preference applies after hydration). */
async function backgroundOf(page: import("@playwright/test").Page, scheme: "dark" | "light"): Promise<string> {
  const dark = scheme === "dark";
  await expect.poll(() => page.evaluate(() => window.matchMedia("(prefers-color-scheme: dark)").matches)).toBe(dark);
  await page.waitForTimeout(300);
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

test("home, work items and a page render in both colour schemes with different backgrounds", async ({ page }) => {
  const project = await createProjectViaMcp();
  const created = await mcp<{ id: string }>("create_page", { project_id: project.id, name: "Scheme page" });
  const backgrounds: Record<string, string[]> = { dark: [], light: [] };
  // The preference is read after hydration from this key (src/components/shell/color-scheme.ts).
  await page.addInitScript(() => window.localStorage.setItem("tessera.scheme.v1", "system"));

  for (const scheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Home" }).first()).toBeVisible();
    backgrounds[scheme]!.push(await backgroundOf(page, scheme));

    const webId = await openWebWorkItems(page);
    await expect(page.locator("[data-list-ready]").first()).toBeVisible();
    expect(webId).toBeTruthy();
    backgrounds[scheme]!.push(await backgroundOf(page, scheme));

    await page.goto(`/projects/${project.id}/pages/${created.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Scheme page" })).toBeVisible();
    backgrounds[scheme]!.push(await backgroundOf(page, scheme));
  }

  for (let index = 0; index < 3; index += 1) {
    expect(backgrounds.dark![index], `screen ${index}: dark and light backgrounds differ`).not.toBe(backgrounds.light![index]);
  }
});
