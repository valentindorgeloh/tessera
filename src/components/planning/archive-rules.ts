/**
 * Archive rules the UI checks before it calls the engine (docs/contracts/ui.md
 * "Archives (E3)"). Pure and directive-free, so Server and Client Components
 * and Vitest can import it; the engine stays the authority (`archiveWorkItem`
 * answers `RULE archive_open_item`, the typed identifier is a UI guard only).
 */
import type { Project, StateGroup } from "@/lib/tessera/types";

/** The disabled Archive entry's description on an open work item. */
export const ARCHIVE_OPEN_ITEM_REASON = "Only completed or cancelled work items can be archived";

/** Only completed or cancelled work items can be archived (the engine's `archive_open_item` rule). */
export function canArchiveWorkItem(group: StateGroup | null | undefined): boolean {
  return group === "completed" || group === "cancelled";
}

/** The Delete project button enables when the typed text is the identifier, trimmed and in any case. */
export function confirmsDelete(identifier: string, typed: string): boolean {
  const expected = identifier.trim().toUpperCase();
  return expected !== "" && typed.trim().toUpperCase() === expected;
}

/** The project's archive lists, each a path segment under `/projects/<id>/archives/`. */
export type ArchiveKind = "work-items" | "cycles" | "modules";
export type ArchiveTabDef = { kind: ArchiveKind; label: string };

const WORK_ITEMS_TAB: ArchiveTabDef = { kind: "work-items", label: "Work items" };
const CYCLES_TAB: ArchiveTabDef = { kind: "cycles", label: "Cycles" };
const MODULES_TAB: ArchiveTabDef = { kind: "modules", label: "Modules" };

/** Work items always; Cycles and Modules only while the feature is turned on. */
export function archiveTabs(project: Pick<Project, "cycles_enabled" | "modules_enabled">): ArchiveTabDef[] {
  const tabs = [WORK_ITEMS_TAB];
  if (project.cycles_enabled) tabs.push(CYCLES_TAB);
  if (project.modules_enabled) tabs.push(MODULES_TAB);
  return tabs;
}

/** The path segment after `archives/` (`/projects/<id>/archives/cycles` → "cycles"); "" when there is none. */
export function activeArchiveKind(pathname: string, projectId: string): string {
  const prefix = `/projects/${projectId}/archives/`;
  if (!pathname.startsWith(prefix)) return "";
  return pathname.slice(prefix.length).split("/")[0] ?? "";
}

/** "Could not restore Sprint 1. The dates overlap cycle "Sprint 3"." — the engine message as a sentence after the subject. */
export function failureText(what: string, message: string): string {
  const text = message.trim();
  if (text === "") return `${what}.`;
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return `${what}. ${/[.!?]$/.test(sentence) ? sentence : `${sentence}.`}`;
}
