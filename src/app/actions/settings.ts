"use server";

/**
 * Project settings mutations (docs/drafts/p4-ui.md "Project settings (F2)",
 * docs/drafts/p4-tools.md): the feature toggles and the actor edits. The
 * General tab saves through `updateProjectAction` (projects.ts). Destructive
 * wrappers elsewhere are called without `confirm`; the UI confirms itself.
 */
import { toolAction } from "./_run";

export const updateProjectFeaturesAction = toolAction("update_project_features");
export const updateActorAction = toolAction("update_actor");
