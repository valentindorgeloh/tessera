/**
 * Lookup order of the scoped project routes (cycle, module and saved view pages;
 * docs/contracts/ui.md "Routes and data loading"). The id is looked up first, so an
 * unknown, deleted or foreign id is "missing" whether the project's feature is on
 * or off, and the page answers `notFound()`. Only an id that exists in this
 * project reaches the feature toggle, which then shows the feature-off state.
 * Feature toggles: decision 31. The order matters to the shell: RecentsTracker records the paths of pages that
 * render, so a feature-off state shown before the lookup stored dead ids as recents
 * (the backlog's "unknown ids recorded in recents" entry). Runs inside the page's
 * one `readTessera` call; never imported by client code. It takes the project
 * row rather than a context, so it carries no engine import.
 */
import { isTrackerError } from "@/lib/tessera/core/errors";
import type { Project } from "@/lib/tessera/types";

export type ScopeLookup<T> = { kind: "found"; value: T } | { kind: "feature_off" } | { kind: "missing" };

/**
 * Loads the scoped record through `load` before the feature toggle is read.
 * A NOT_FOUND or VALIDATION error from `load`, or a record of another project,
 * is "missing". The caller reads the project first (`getProject`), so an
 * unknown project still throws its own NOT_FOUND, which the page maps to
 * `notFound()` as before.
 */
export function lookupScoped<T>(
  project: Project,
  options: {
    isEnabled: (project: Project) => boolean;
    load: (project: Project) => T;
    projectIdOf: (value: T) => string | null;
  },
): ScopeLookup<T> {
  let value: T;
  try {
    value = options.load(project);
  } catch (err) {
    if (isTrackerError(err) && (err.code === "NOT_FOUND" || err.code === "VALIDATION")) return { kind: "missing" };
    throw err;
  }
  if (options.projectIdOf(value) !== project.id) return { kind: "missing" };
  return options.isEnabled(project) ? { kind: "found", value } : { kind: "feature_off" };
}
