/**
 * Intake list helpers. Pure: no React, so Vitest covers them
 * (tests/ui/intake-format.test.ts).
 */
import type { IntakeItemView, IntakeSource, IntakeTab } from "@/lib/tessera/types";

export const INTAKE_TABS: readonly IntakeTab[] = ["open", "snoozed", "closed"];

const TAB_SET: ReadonlySet<string> = new Set(INTAKE_TABS);

export type IntakeQuery = { tab: IntakeTab; q: string; item: string | null };

function first(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

/** `?tab=&q=&item=` of the intake page. An unknown tab is Open. */
export function parseIntakeQuery(params: Record<string, string | string[] | undefined>): IntakeQuery {
  const tabRaw = first(params.tab) ?? "";
  const tab: IntakeTab = TAB_SET.has(tabRaw) ? (tabRaw as IntakeTab) : "open";
  return { tab, q: (first(params.q) ?? "").trim(), item: first(params.item) };
}

/** Path of an intake list, omitting the defaults (Open, no search, no item). */
export function intakeHref(projectId: string, tab: IntakeTab, q: string, item: string | null): string {
  const params = new URLSearchParams();
  if (tab !== "open") params.set("tab", tab);
  if (q !== "") params.set("q", q);
  if (item) params.set("item", item);
  const query = params.toString();
  const path = `/projects/${projectId}/intake`;
  return query === "" ? path : `${path}?${query}`;
}

/** "In app", "Assistant" or "MCP". */
export function sourceLabel(source: IntakeSource): string {
  if (source === "in_app") return "In app";
  if (source === "assistant") return "Assistant";
  return "MCP";
}

/** The row's status token, or null while the item is still pending. */
export function statusToken(view: Pick<IntakeItemView, "status" | "snoozed_till" | "duplicate_to">): string | null {
  if (view.status === "pending") return null;
  if (view.status === "snoozed") return `Snoozed until ${view.snoozed_till?.slice(0, 10) ?? ""}`;
  if (view.status === "declined") return "Declined";
  if (view.status === "duplicate") return `Duplicate of ${view.duplicate_to?.key ?? "another item"}`;
  return "Accepted";
}

/**
 * The next open item after `id`, or the one before it when `id` is last.
 * Null when the list has nothing else.
 */
export function nextOpenItem(ids: readonly string[], id: string): string | null {
  const index = ids.indexOf(id);
  if (index < 0) return ids[0] ?? null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}
