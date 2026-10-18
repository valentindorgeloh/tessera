import { getAutomationStatus, runAutomations, RunAutomationsInput } from "../../automations";
import { defineTool } from "../define";
import { EmptyInput } from "./shared";

export const automationTools = [
  defineTool({
    name: "run_automations",
    title: "Run automations",
    description:
      "Closes inactive work items and archives closed ones for one project or every active project, acting as the system actor. A dry run returns the counts and writes nothing. When another runner holds the lease, this call applies nothing and reports the lease held.",
    input: RunAutomationsInput,
    mutates: true,
    phase: "P10",
    run: (ctx, input) => runAutomations(ctx, input),
  }),
  defineTool({
    name: "get_automation_status",
    title: "Get automation status",
    description:
      "Returns the last automation run, when the next hourly run is due, and how many work items each active project would close or archive at the current clock.",
    input: EmptyInput,
    mutates: false,
    phase: "P10",
    run: (ctx) => getAutomationStatus(ctx),
  }),
];
