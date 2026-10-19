"use server";

/**
 * Automation mutations for the project settings (docs/drafts/p10-plan.md "Automations tab").
 * `updateAutomationSettingsAction` is `update_project` limited to the three automation
 * fields; `runAutomationsAction` runs the closer and archiver for one project.
 */
import { toolAction } from "./_run";

export const runAutomationsAction = toolAction("run_automations");
export const updateAutomationSettingsAction = toolAction("update_project");
export const getAutomationStatusAction = toolAction("get_automation_status");
