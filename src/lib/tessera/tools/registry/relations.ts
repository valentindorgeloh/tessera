import { addRelation, AddRelationInput, listRelations, removeRelation } from "../../relations";
import { defineTool } from "../define";
import { z } from "zod";
import { IdSchema } from "../../schemas";

const ListInput = z.object({ work_item_id: IdSchema.describe("Work item whose relations to list.") }).strict();
const RemoveInput = z
  .object({
    work_item_id: IdSchema.describe("One side of the relation."),
    related_work_item_id: IdSchema.describe("The other side."),
  })
  .strict();

export const relationTools = [
  defineTool({
    name: "list_relations",
    title: "List relations",
    description: "Lists the live relations of a work item, shown from that item's side (blocked by, blocking, and the rest).",
    input: ListInput,
    mutates: false,
    core: true,
    phase: "P7",
    run: (ctx, { work_item_id }) => listRelations(ctx, work_item_id),
  }),
  defineTool({
    name: "add_relation",
    title: "Add relation",
    description: "Adds a relation to another work item, including across projects. An existing pair is replaced with the new type.",
    input: AddRelationInput,
    mutates: true,
    phase: "P7",
    run: (ctx, input) => addRelation(ctx, input),
  }),
  defineTool({
    name: "remove_relation",
    title: "Remove relation",
    description: "Removes the relation between two work items, whichever direction it was stored in.",
    input: RemoveInput,
    mutates: true,
    phase: "P7",
    run: (ctx, { work_item_id, related_work_item_id }) => removeRelation(ctx, work_item_id, related_work_item_id),
  }),
];
