import { z } from "zod";
import { createEstimate, deleteEstimate, EstimatePointInput, getEstimate, listEstimates, updateEstimate } from "../../estimates";
import { EstimateTypeSchema, IdSchema } from "../../schemas";
import { defineTool } from "../define";
import { deleted, ProjectId } from "./shared";

const EstimateId = IdSchema.describe("Estimate system id.");
const IdInput = z.object({ estimate_id: EstimateId }).strict();

const ListInput = z
  .object({
    project_id: ProjectId,
    include_archived: z.boolean().optional().describe("Include archived systems. Defaults to the active system only."),
  })
  .strict();

const CreateInput = z
  .object({
    project_id: ProjectId,
    name: z.string().trim().min(1).max(120).describe("Name of the estimate system."),
    type: EstimateTypeSchema.describe("points, categories or time."),
    points: z.array(EstimatePointInput).min(2).max(6).describe("Two to six values, lowest first. No ids. An active system is archived and matching values are kept."),
  })
  .strict();

const UpdateInput = z
  .object({
    estimate_id: EstimateId,
    name: z.string().trim().min(1).max(120).optional().describe("New name."),
    points: z.array(EstimatePointInput).min(2).max(6).optional().describe("The full ordered point list. Ids keep their identity. Omitted points are removed."),
    remap: z.record(z.string(), z.string().nullable()).optional().describe("Removed point id to a point that stays, or null to clear. Required when items still use a removed point."),
  })
  .strict();

export const estimateTools = [
  defineTool({
    name: "list_estimates",
    title: "List estimates",
    description: "Lists a project's estimate systems and their points. Archived systems are omitted unless include_archived is set. A project has at most one active system.",
    input: ListInput,
    mutates: false,
    phase: "P8",
    run: (ctx, input) => listEstimates(ctx, input),
  }),
  defineTool({
    name: "get_estimate",
    title: "Get estimate",
    description: "Returns one estimate system by id, including its points in position order and whether it is archived.",
    input: IdInput,
    mutates: false,
    phase: "P8",
    run: (ctx, { estimate_id }) => getEstimate(ctx, estimate_id),
  }),
  defineTool({
    name: "create_estimate",
    title: "Create estimate",
    description: "Creates an estimate system of 2 to 6 points. If the project already has an active system, that system is archived and items keep a point only when the new system has the same value and type. Destructive.",
    input: CreateInput,
    mutates: true,
    destructive: true,
    phase: "P8",
    run: (ctx, input) => createEstimate(ctx, input),
  }),
  defineTool({
    name: "update_estimate",
    title: "Update estimate",
    description: "Replaces the name or the full point list of an active system. A removed point that items still use needs a remap entry, or the call is RULE estimate_point_in_use and nothing changes. Destructive.",
    input: UpdateInput,
    mutates: true,
    destructive: true,
    phase: "P8",
    run: (ctx, { estimate_id, ...input }) => updateEstimate(ctx, estimate_id, input),
  }),
  defineTool({
    name: "delete_estimate",
    title: "Delete estimate",
    description: "Soft-deletes an estimate system, clears it from the project, and clears the estimate on every work item that used its points. Destructive.",
    input: IdInput,
    mutates: true,
    destructive: true,
    phase: "P8",
    run: (ctx, { estimate_id }) => {
      deleteEstimate(ctx, estimate_id);
      return deleted(estimate_id);
    },
  }),
];
