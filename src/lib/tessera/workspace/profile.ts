/**
 * Your work and agent profiles. The three count blocks are getCounts profile
 * scopes, so they match the profile lists.
 */
import { and, count, eq, gte, inArray, isNull, lt, max } from "drizzle-orm";
import { z } from "zod";
import { listActivity } from "../changes";
import { countsPopulation, getCounts } from "../counts";
import type { TesseraContext } from "../core/context";
import { notFound, validateInput } from "../core/errors";
import { addDays, localDayStart } from "../core/time";
import { activity, actor, project, state, work_item } from "../db/schema";
import { IdSchema } from "../schemas";
import type { ActorRow, AgentProfileRow, ProfileActor, ProfileSummary } from "../types";

const AGENT_KINDS = ["assistant", "agent", "system"] as const;

function toActor(row: ActorRow): ProfileActor {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    color: row.color,
    access: row.access,
    last_seen_at: row.last_seen_at,
  };
}

export const GetProfileSummaryInput = z.object({ actor_id: IdSchema.describe("Actor whose profile is summarised.") }).strict();

export type GetProfileSummaryInputType = z.input<typeof GetProfileSummaryInput>;

export function getProfileSummary(ctx: TesseraContext, input: GetProfileSummaryInputType): ProfileSummary {
  const data = validateInput(GetProfileSummaryInput, input);
  const row = ctx.db.select().from(actor).where(and(eq(actor.id, data.actor_id), isNull(actor.deleted_at))).get();
  if (!row) throw notFound("actor", data.actor_id);
  const scope = { type: "profile" as const, actor_id: data.actor_id };
  const assigned = getCounts(ctx, { ...scope, tab: "assigned" });
  const population = countsPopulation(ctx, { ...scope, tab: "assigned" });
  const from = localDayStart(addDays(ctx.today(), -29));
  const until = localDayStart(addDays(ctx.today(), 1));
  const completed = ctx.db
    .select({ n: count() })
    .from(work_item)
    .where(and(population.where, gte(work_item.completed_at, from), lt(work_item.completed_at, until)))
    .get();
  const grouped = ctx.db
    .select({ project_id: work_item.project_id, name: project.name, state_group: state.state_group, n: count() })
    .from(work_item)
    .innerJoin(project, eq(work_item.project_id, project.id))
    .innerJoin(state, eq(work_item.state_id, state.id))
    .where(population.where)
    .groupBy(work_item.project_id, project.name, state.state_group)
    .all();
  const projects = new Map<string, { project_id: string; name: string; total: number; closed: number }>();
  for (const item of grouped) {
    const current = projects.get(item.project_id) ?? { project_id: item.project_id, name: item.name, total: 0, closed: 0 };
    current.total += item.n;
    if (item.state_group === "completed" || item.state_group === "cancelled") current.closed += item.n;
    projects.set(item.project_id, current);
  }
  return {
    actor: toActor(row),
    assigned,
    created: getCounts(ctx, { ...scope, tab: "created" }),
    subscribed: getCounts(ctx, { ...scope, tab: "subscribed" }),
    completed_last_30d: completed?.n ?? 0,
    projects: [...projects.values()]
      .map((item) => ({ project_id: item.project_id, name: item.name, assigned_open: item.total - item.closed }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    recent_activity: listActivity(ctx, { actor_id: data.actor_id, limit: 10 }).reverse(),
  };
}

/** Assistant, agent and system actors. A server read for the Agents screen; not a tool. */
export function listAgentProfiles(ctx: TesseraContext): AgentProfileRow[] {
  const actors = ctx.db
    .select()
    .from(actor)
    .where(and(isNull(actor.deleted_at), inArray(actor.kind, [...AGENT_KINDS])))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  if (actors.length === 0) return [];
  const ids = actors.map((row) => row.id);
  const cutoff = new Date(new Date(ctx.now()).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const activityRows = ctx.db
    .select({ actor_id: activity.actor_id, last: max(activity.created_at), n: count() })
    .from(activity)
    .where(inArray(activity.actor_id, ids))
    .groupBy(activity.actor_id)
    .all();
  const recentRows = ctx.db
    .select({ actor_id: activity.actor_id, n: count() })
    .from(activity)
    .where(and(inArray(activity.actor_id, ids), gte(activity.created_at, cutoff)))
    .groupBy(activity.actor_id)
    .all();
  const lastByActor = new Map(activityRows.map((row) => [row.actor_id, row.last]));
  const weekByActor = new Map(recentRows.map((row) => [row.actor_id, row.n]));
  return actors.map((row) => {
    const assigned = getCounts(ctx, { type: "profile", actor_id: row.id, tab: "assigned" });
    return {
      actor: toActor(row),
      assigned_open: assigned.total - assigned.by_state_group.completed - assigned.by_state_group.cancelled,
      last_activity_at: lastByActor.get(row.id) ?? null,
      activity_7d: weekByActor.get(row.id) ?? 0,
    };
  });
}
