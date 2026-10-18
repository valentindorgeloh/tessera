import { z } from "zod";
import {
  acceptIntakeItem,
  createIntakeItem,
  CreateIntakeItemInput,
  declineIntakeItem,
  deleteIntakeItem,
  getIntakeItem,
  listIntakeItems,
  ListIntakeItemsInput,
  markIntakeDuplicate,
  snoozeIntakeItem,
  unsnoozeIntakeItem,
} from "../../intake";
import { IdSchema } from "../../schemas";
import { defineTool } from "../define";
import { deleted } from "./shared";

const IntakeItemId = IdSchema.describe("Intake item id.");
const IdInput = z.object({ intake_item_id: IntakeItemId }).strict();

const AcceptInput = z
  .object({
    intake_item_id: IntakeItemId,
    state_id: IdSchema.optional().describe("State to accept into. The project default when omitted. The triage state is refused."),
  })
  .strict();

const SnoozeInput = z
  .object({
    intake_item_id: IntakeItemId,
    until: z.string().describe("ISO-8601 instant in the future when the item returns to Open."),
  })
  .strict();

const DuplicateInput = z
  .object({
    intake_item_id: IntakeItemId,
    duplicate_of_id: IdSchema.describe("The original work item. Not this item, and not one still pending in Intake."),
  })
  .strict();

export const intakeTools = [
  defineTool({
    name: "list_intake_items",
    title: "List intake items",
    description: "Lists a project's intake items for one tab (open, snoozed or closed), newest first, with the three tab counts. A snoozed item whose time has passed is open.",
    input: ListIntakeItemsInput,
    mutates: false,
    phase: "P8",
    run: (ctx, input) => listIntakeItems(ctx, input),
  }),
  defineTool({
    name: "get_intake_item",
    title: "Get intake item",
    description: "Returns one intake item by its id, including the work item key, status, source and who submitted it.",
    input: IdInput,
    mutates: false,
    phase: "P8",
    run: (ctx, { intake_item_id }) => getIntakeItem(ctx, intake_item_id),
  }),
  defineTool({
    name: "create_intake_item",
    title: "Create intake item",
    description: "Creates a work item directly in Intake for any actor. Intake must be on (RULE feature_disabled). The source follows the actor: in app, assistant or MCP.",
    input: CreateIntakeItemInput,
    mutates: true,
    phase: "P8",
    run: (ctx, input) => createIntakeItem(ctx, input),
  }),
  defineTool({
    name: "accept_intake_item",
    title: "Accept intake item",
    description: "Accepts an intake item into a state of the same project, or the project default. The triage state is refused. An accepted item cannot be accepted again (RULE intake_closed).",
    input: AcceptInput,
    mutates: true,
    destructive: true,
    phase: "P8",
    run: (ctx, { intake_item_id, state_id }) => acceptIntakeItem(ctx, intake_item_id, { state_id }),
  }),
  defineTool({
    name: "decline_intake_item",
    title: "Decline intake item",
    description: "Declines an intake item. It stays in the hidden triage state and moves to the Closed tab. It can still be accepted later. An accepted item cannot be declined.",
    input: IdInput,
    mutates: true,
    destructive: true,
    phase: "P8",
    run: (ctx, { intake_item_id }) => declineIntakeItem(ctx, intake_item_id),
  }),
  defineTool({
    name: "snooze_intake_item",
    title: "Snooze intake item",
    description: "Snoozes a pending intake item until an ISO-8601 instant in the future. Accepted, declined and duplicate items cannot be snoozed. A past time is VALIDATION.",
    input: SnoozeInput,
    mutates: true,
    phase: "P8",
    run: (ctx, { intake_item_id, until }) => snoozeIntakeItem(ctx, intake_item_id, { until }),
  }),
  defineTool({
    name: "unsnooze_intake_item",
    title: "Unsnooze intake item",
    description: "Returns a snoozed intake item to pending so it shows on the Open tab again. Items that are not snoozed are refused.",
    input: IdInput,
    mutates: true,
    phase: "P8",
    run: (ctx, { intake_item_id }) => unsnoozeIntakeItem(ctx, intake_item_id),
  }),
  defineTool({
    name: "mark_intake_duplicate",
    title: "Mark intake duplicate",
    description: "Marks an open intake item as a duplicate of another work item and adds a duplicate relation. Refuses the item itself and a target that is still pending in Intake.",
    input: DuplicateInput,
    mutates: true,
    destructive: true,
    phase: "P8",
    run: (ctx, { intake_item_id, duplicate_of_id }) => markIntakeDuplicate(ctx, intake_item_id, { duplicate_of_id }),
  }),
  defineTool({
    name: "delete_intake_item",
    title: "Delete intake item",
    description: "Soft-deletes a non-accepted intake item together with its work item. An accepted item is RULE intake_closed: delete the work item instead. Destructive.",
    input: IdInput,
    mutates: true,
    destructive: true,
    phase: "P8",
    run: (ctx, { intake_item_id }) => {
      deleteIntakeItem(ctx, intake_item_id);
      return deleted(intake_item_id);
    },
  }),
];
