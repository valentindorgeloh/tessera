/**
 * Feature toggles for Power K and the shortcuts (decision 31): turning cycles,
 * modules or views off hides their palette entries and silences their
 * shortcuts. The shell sits above every ProjectProvider, so the Tessera layout
 * hands it the flags of every project (`projectFeatureMap`, stored through
 * `RecentsTracker`) and the palette and the dispatcher read them here. A
 * project the map does not hold counts as having every feature on, which is
 * also what outside a project means. Pure apart from the module store.
 */
import type { Project } from "@/lib/tessera/types";
import type { ShortcutId } from "./shortcuts";

export type ProjectFeature = "cycles" | "modules" | "views";

export type ProjectFeatures = Readonly<Record<ProjectFeature, boolean>>;

export type ProjectFeatureMap = Readonly<Record<string, ProjectFeatures>>;

/** The feature each create and navigate shortcut belongs to; every other shortcut belongs to none. */
export const SHORTCUT_FEATURE: Readonly<Partial<Record<ShortcutId, ProjectFeature>>> = {
  "create.cycle": "cycles",
  "nav.cycles": "cycles",
  "create.module": "modules",
  "nav.modules": "modules",
  "create.view": "views",
  "nav.views": "views",
};

const FEATURE_LABELS: Readonly<Record<ProjectFeature, string>> = { cycles: "Cycles", modules: "Modules", views: "Views" };

/** Project id → its feature flags, for the layout to hand to the shell. */
export function projectFeatureMap(
  projects: readonly Pick<Project, "id" | "cycles_enabled" | "modules_enabled" | "views_enabled">[],
): ProjectFeatureMap {
  return Object.fromEntries(
    projects.map((project) => [project.id, { cycles: project.cycles_enabled, modules: project.modules_enabled, views: project.views_enabled }]),
  );
}

/** True when `id` belongs to a feature that `features` turns off; false for no features (outside a project) and for other shortcuts. */
export function isShortcutHidden(id: string, features: ProjectFeatures | null | undefined): boolean {
  if (!features) return false;
  const feature = SHORTCUT_FEATURE[id as ShortcutId];
  return feature !== undefined && !features[feature];
}

/** The toast a hidden shortcut shows, or null when it is available: "Cycles are turned off for this project". */
export function shortcutOffMessage(id: ShortcutId, features: ProjectFeatures | null | undefined): string | null {
  if (!isShortcutHidden(id, features)) return null;
  const feature = SHORTCUT_FEATURE[id];
  return feature ? `${FEATURE_LABELS[feature]} are turned off for this project` : null;
}

let featureMap: ProjectFeatureMap = {};

/** Replaces the flags the shell knows (called by `RecentsTracker` with the layout's read). */
export function setProjectFeatures(next: ProjectFeatureMap): void {
  featureMap = next;
}

/** The flags of a project, or null for no project or one the shell has not heard of. */
export function readProjectFeatures(projectId: string | null): ProjectFeatures | null {
  if (projectId === null) return null;
  return Object.hasOwn(featureMap, projectId) ? featureMap[projectId] : null;
}
