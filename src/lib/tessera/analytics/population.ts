/**
 * Shared analytics population. Distributions use the same WHERE as getCounts.
 * Trends include archived items of the same live projects.
 */
import { countsPopulation, type CountsPopulation } from "../counts";
import type { TesseraContext } from "../core/context";

export function distributionPopulation(ctx: TesseraContext, projectIds: string[] | undefined): CountsPopulation {
  return countsPopulation(ctx, projectIds === undefined ? { type: "workspace" } : { type: "workspace", project_ids: projectIds });
}

export function trendPopulation(ctx: TesseraContext, projectIds: string[] | undefined): CountsPopulation {
  return countsPopulation(ctx, projectIds === undefined ? { type: "workspace" } : { type: "workspace", project_ids: projectIds }, { includeArchived: true });
}
