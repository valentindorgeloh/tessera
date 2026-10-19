import { expect, type Page } from "@playwright/test";

/**
 * Console noise the field guide tolerates (Astryx Table ContextMenu props,
 * React's prerender measure warning, Chrome's nameless form-field note).
 */
const TOLERATED = /moveTo|\bstart\b|\bcancel\b|cannot have a negative time stamp|form field should have an id or name/i;

/** Fail the test on page or console errors outside the tolerated set. */
export function attachConsoleGuard(page: Page): { assertClean: () => void } {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return {
    assertClean: () => {
      expect(errors.filter((text) => !TOLERATED.test(text))).toEqual([]);
    },
  };
}

const PROJECT_WORK_ITEMS = /\/projects\/([0-9a-f-]{20,})\/work-items/;

/** Resolve the seeded WEB project to its UUID via the project index redirect. */
export async function openWebWorkItems(page: Page): Promise<string> {
  await page.goto("/projects/WEB");
  await page.waitForURL(PROJECT_WORK_ITEMS, { timeout: 30_000 });
  const match = page.url().match(PROJECT_WORK_ITEMS);
  expect(match?.[1]).toBeTruthy();
  return match![1]!;
}
