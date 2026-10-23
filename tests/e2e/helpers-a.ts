/**
 * Helpers for the coverage-drops and coverage-timeline specs (lane e2e-a).
 * They sit on top of fixtures.ts (no existing helper is changed): MCP reads
 * that turn a tool result into the few fields a drop test compares, and date
 * arithmetic that matches the app's calendar days.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, isoDay, mcp } from "./fixtures";

type Listed<T> = { items?: T[]; result?: T[] };

export type ItemFields = {
  id: string;
  key: string;
  name: string;
  state_id: string;
  start_date: string | null;
  target_date: string | null;
  cycle_id: string | null;
};

/** The saved fields of a work item, read over MCP (what a reload would show). */
export async function getItem(id: string): Promise<ItemFields> {
  return mcp<ItemFields>("get_work_item", { work_item_id: id });
}

/** Creates a work item and returns its saved fields. */
export async function createItem(projectId: string, name: string, extra: Record<string, unknown> = {}): Promise<ItemFields> {
  return mcp<ItemFields>("create_work_item", { project_id: projectId, name, ...extra });
}

/** The id of a project state by its name ("Backlog", "Todo", "In Progress", ...). */
export async function stateId(projectId: string, stateName: string): Promise<string> {
  const listed = await mcp<Listed<{ id: string; name: string }>>("list_states", { project_id: projectId });
  const found = (listed.items ?? listed.result ?? []).find((row) => row.name === stateName);
  expect(found, `state ${stateName}`).toBeTruthy();
  return found!.id;
}

/** `YYYY-MM-DD` plus `days` calendar days (UTC arithmetic on the date string, no clock). */
export function addIsoDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function diffIsoDays(from: string, to: string): number {
  const parse = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year!, month! - 1, day!);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** 0 Sunday ... 6 Saturday for a `YYYY-MM-DD` date. */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

/** The workspace week start (0 Sunday ... 6 Saturday), read over MCP. */
export async function getWeekStart(): Promise<number> {
  const settings = await mcp<{ week_start: number }>("get_workspace_settings");
  return settings.week_start;
}

/** Sets the workspace week start (0 Sunday, 1 Monday). The specs that change it put it back in a `finally`. */
export async function setWeekStart(value: number): Promise<void> {
  await mcp("update_workspace_settings", { week_start: value });
}

/** The pixel width of one gantt day column, measured from the bar of an item that spans `days` days. */
export async function ganttDayWidth(bar: Locator, days: number): Promise<number> {
  const box = await bar.boundingBox();
  expect(box, "gantt bar is on screen").not.toBeNull();
  // A bar sits 4 px inside its day columns on both sides (--tessera-gantt-inset).
  return (box!.width + 8) / days;
}

/** The text of every element matching `selector`, whitespace collapsed. */
export async function texts(page: Page, selector: string): Promise<string[]> {
  const all = await page.locator(selector).allTextContents();
  return all.map((text) => text.replace(/\s+/g, " ").trim());
}

/** A `YYYY-MM-DD` day `offset` days from today with a fixed weekday, so a fixture does not depend on the day the suite runs. */
export function nextWeekday(weekday: number, minOffset = 1): string {
  for (let offset = minOffset; offset < minOffset + 7; offset += 1) {
    if (weekdayOf(isoDay(offset)) === weekday) return isoDay(offset);
  }
  throw new Error(`no weekday ${weekday} within a week of offset ${minOffset}`);
}
