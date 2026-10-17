/**
 * Scope of the route on screen (docs/drafts/p5-plan.md §6). Pure: the panel
 * and `ask` pass the pathname and the query. Project ids come from
 * `projectIdFromPath` (never a hand-written project regex; `/projects/archives`
 * is not a project). The open work item is the detail route or the peek param.
 */
import { formatKey, parseKey } from "@/lib/tessera/core/keys";
import { IdSchema } from "@/lib/tessera/schemas";
import type { AssistantScope } from "@/lib/tessera/types";
import { peekIdOf, type SearchParamsLike } from "@/components/detail/peek-url";
import { projectIdFromPath } from "@/components/shell/recents";

const PROJECT_IDENTIFIER = /^[A-Z][A-Z0-9]{1,11}$/;

function segments(pathname: string): string[] {
  const bare = pathname.split(/[?#]/, 1)[0] ?? "";
  return bare
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

function asId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = IdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * `AssistantScope` for `pathname` and its query. Invalid ids are left out.
 * A work item in the path wins over `?peek=`; a list uses the peek.
 */
export function scopeFromLocation(pathname: string, searchParams: SearchParamsLike | null | undefined): AssistantScope {
  const parts = segments(pathname);
  const scope: AssistantScope = {};
  const projectId = asId(projectIdFromPath(pathname) ?? undefined);
  if (projectId) scope.project_id = projectId;

  let workItemId: string | undefined;
  if (parts[0] === "work-items") workItemId = parts[1];
  if (parts[0] === "projects" && parts[2] === "work-items") workItemId = parts[3];
  if (!workItemId) workItemId = peekIdOf(searchParams) ?? undefined;
  const itemId = asId(workItemId);
  if (itemId) scope.work_item_id = itemId;

  if (parts[0] === "projects" && parts[2] === "cycles") {
    const cycleId = asId(parts[3]);
    if (cycleId) scope.cycle_id = cycleId;
  }
  if (parts[0] === "projects" && parts[2] === "modules") {
    const moduleId = asId(parts[3]);
    if (moduleId) scope.module_id = moduleId;
  }
  return scope;
}

/** The project frame token's text, when it is a project identifier such as WEB. */
export function parseProjectIdentifier(text: string | null | undefined): string | null {
  const value = text?.trim().toUpperCase() ?? "";
  return PROJECT_IDENTIFIER.test(value) ? value : null;
}

/** Leading `WEB-12` of a recents label (`WEB-12 Fix login`), else null. */
export function keyFromLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const first = label.trim().split(/\s+/)[0] ?? "";
  const parsed = parseKey(first);
  return parsed ? formatKey(parsed.identifier, parsed.sequenceId) : null;
}

/** Visible header: "Assistant · WEB" on a project, subtitle "WEB · WEB-1" when an item is open. */
export function assistantHeading(projectIdentifier: string | null, workItemKey: string | null): { title: string; subtitle: string | null } {
  const parsed = workItemKey ? parseKey(workItemKey) : null;
  if (parsed) {
    const key = formatKey(parsed.identifier, parsed.sequenceId);
    return { title: "Assistant", subtitle: `${parsed.identifier} · ${key}` };
  }
  if (projectIdentifier) return { title: `Assistant · ${projectIdentifier}`, subtitle: null };
  return { title: "Assistant", subtitle: null };
}

/** Composer placeholder: a project route, or Tessera at large. */
export function composerPlaceholder(scope: AssistantScope): string {
  if (scope.project_id || scope.work_item_id || scope.cycle_id || scope.module_id) return "Ask about this project…";
  return "Ask about Tessera…";
}

const NEXT = "What should I work on next?";
const CHANGED = "What changed this week?";
const PROGRESS = "What is in progress?";

/**
 * Three suggestion labels for the empty panel, most specific first. A project
 * list is "what changed", "what next" and "what is in progress"; a work item,
 * cycle or module replaces the first with its own question.
 */
export function scopeSuggestions(scope: AssistantScope): readonly [string, string, string] {
  const specific: string[] = [];
  if (scope.work_item_id) specific.push("What is this item about?");
  if (scope.cycle_id) specific.push("Summarise this cycle");
  if (scope.module_id) specific.push("Summarise this module");
  if (scope.project_id || scope.work_item_id || scope.cycle_id || scope.module_id) specific.push(CHANGED);
  const pool = [...specific, NEXT, CHANGED, PROGRESS];
  const unique: string[] = [];
  for (const item of pool) {
    if (!unique.includes(item)) unique.push(item);
    if (unique.length === 3) break;
  }
  return [unique[0] ?? NEXT, unique[1] ?? CHANGED, unique[2] ?? PROGRESS];
}
