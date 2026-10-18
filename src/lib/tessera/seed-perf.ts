/**
 * Deterministic performance fixture (decision 115, plan 4.5). `seedPerf`
 * builds the workspace the perf budgets are measured on: one big project plus
 * a few small ones, labels, actors, cycles, modules, relations, comments and
 * activity. Everything goes through the service functions inside batched
 * transactions of 500, so every row has activity, FTS and sequence numbers
 * exactly as in real use. The random numbers come from mulberry32 and the clock
 * is fixed (a base date that advances one second per call), so the same options
 * always produce the same rows. Counts scale with `items`: the full shape is
 * 10 000 + 2 000 items, 40 labels, 8 actors, 12 cycles, 20 modules, 3 000
 * relations, 5 000 comments and 30 000 activity rows.
 */
import { registerActor, USER_ACTOR_ID } from "./actors";
import { createComment } from "./comments";
import { createContext, type TesseraContext } from "./core/context";
import { isTrackerError } from "./core/errors";
import { addDays } from "./core/time";
import { createCycle } from "./cycles";
import { createLabel } from "./labels";
import { createModule } from "./modules";
import { createProject, getProject } from "./projects";
import { addRelation } from "./relations";
import { listStates } from "./states";
import type { PaletteColor, Priority } from "./types";
import { createWorkItem, updateWorkItem } from "./work-items";

/** The date the fixture is built on; cycles, modules and item dates are offsets from it. */
export const PERF_BASE_DATE = "2026-09-01";
const PERF_BASE_MS = Date.parse(`${PERF_BASE_DATE}T08:00:00.000Z`);
const BATCH = 500;
const LABELS = 40;
const CYCLES = 12;
const MODULES = 20;
const AGENTS = 5;

export type SeedPerfOptions = {
  /** Work items in the big project. */
  items: number;
  /** Small projects next to it (default 4). */
  projects?: number;
  /** Work items spread over the small projects (default one fifth of `items`). */
  other_items?: number;
  /** mulberry32 seed (default 11). */
  seed?: number;
  /** Identifier of the big project (default PERF); the small ones add A, B, ... */
  identifier?: string;
  onProgress?: (message: string) => void;
};

export type SeedPerfResult = {
  created: boolean;
  project_id: string;
  counts: { projects: number; work_items: number; labels: number; actors: number; cycles: number; modules: number; relations: number; comments: number; activity: number };
};

/** mulberry32: a small seeded generator returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VERBS = ["Fix", "Add", "Refactor", "Document", "Review", "Migrate", "Polish", "Investigate", "Remove", "Speed up", "Test", "Design"];
const NOUNS = ["checkout", "login form", "search index", "billing page", "export job", "onboarding", "settings screen", "webhook", "dashboard", "notification", "report", "cache", "importer", "sidebar", "profile", "calendar", "invoice", "API client"];
const QUALIFIERS = ["on mobile", "for large accounts", "after the upgrade", "with keyboard only", "in dark mode", "before launch", "for the beta", "under load", "in the nightly build", "for new users"];
const SENTENCES = [
  "The current behaviour is inconsistent between screens and needs one source of truth.",
  "Steps to reproduce are in the linked thread; the failure is intermittent.",
  "We agreed to keep the public shape and change only the internals.",
  "This blocks the next release unless the scope is cut.",
  "Measure first, then decide whether a cache is worth the extra invalidation.",
  "Add a regression test that covers the empty and the very large case.",
];
const STATES = [
  { name: "Backlog", weight: 30 },
  { name: "Todo", weight: 20 },
  { name: "In Progress", weight: 15 },
  { name: "Done", weight: 28 },
  { name: "Cancelled", weight: 7 },
];
const PRIORITIES: readonly Priority[] = ["none", "low", "medium", "high", "urgent"];
const PRIORITY_WEIGHTS = [40, 20, 22, 13, 5];
const COLORS: readonly PaletteColor[] = ["red", "orange", "yellow", "green", "teal", "cyan", "blue", "purple", "pink", "gray"];
const RELATION_TYPES = ["blocked_by", "blocking", "relates_to", "duplicate", "start_before", "finish_before", "implemented_by"] as const;

type Rng = () => number;

function pickIndex(rng: Rng, length: number): number {
  return Math.floor(rng() * length);
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[pickIndex(rng, list.length)] as T;
}

function weighted(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i] as number;
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

/** `count` distinct entries of `list` (fewer when the list is short). */
function sample<T>(rng: Rng, list: readonly T[], count: number): T[] {
  const pool = [...list];
  const out: T[] = [];
  while (out.length < count && pool.length > 0) out.push(pool.splice(pickIndex(rng, pool.length), 1)[0] as T);
  return out;
}

function itemName(rng: Rng, n: number): string {
  return `${pick(rng, VERBS)} ${pick(rng, NOUNS)} ${pick(rng, QUALIFIERS)} (${n})`;
}

function itemBody(rng: Rng): string {
  const lines = [`## ${pick(rng, NOUNS)}`, ...sample(rng, SENTENCES, 2 + pickIndex(rng, 2))];
  return lines.join("\n\n");
}

/** A context on the same database whose clock is fixed and deterministic. */
function seededContext(ctx: TesseraContext): TesseraContext {
  let tick = 0;
  return createContext({
    db: ctx.db,
    sqlite: ctx.sqlite,
    actorId: ctx.actor.id,
    now: () => new Date(PERF_BASE_MS + tick++ * 1000).toISOString(),
    today: () => PERF_BASE_DATE,
  });
}

function runBatch(ctx: TesseraContext, fn: () => void): void {
  ctx.sqlite.transaction(fn).immediate();
}

/** Runs `fn(i)` for 0..total-1 in transactions of BATCH calls. */
function inBatches(ctx: TesseraContext, total: number, fn: (i: number) => void): void {
  for (let from = 0; from < total; from += BATCH) {
    const to = Math.min(total, from + BATCH);
    runBatch(ctx, () => {
      for (let i = from; i < to; i += 1) fn(i);
    });
  }
}

function activityCount(ctx: TesseraContext): number {
  return (ctx.sqlite.prepare("SELECT count(*) AS n FROM activity").get() as { n: number }).n;
}

function tableCount(ctx: TesseraContext, table: string): number {
  return (ctx.sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE deleted_at IS NULL`).get() as { n: number }).n;
}

type Taxonomy = { labels: string[]; cycles: string[]; modules: string[]; actors: string[] };

function seedTaxonomy(ctx: TesseraContext, rng: Rng, projectId: string): Taxonomy {
  const agents = Array.from({ length: AGENTS }, (_, i) => registerActor(ctx, { kind: "agent", name: `perf-agent-${i + 1}`, color: COLORS[i % COLORS.length] }).id);
  const actors = [USER_ACTOR_ID, ...agents];
  const labels: string[] = [];
  const tops: string[] = [];
  runBatch(ctx, () => {
    for (let i = 0; i < LABELS; i += 1) {
      const nested = i >= LABELS - 8;
      const label = createLabel(ctx, {
        project_id: projectId,
        name: `${nested ? "sub" : "area"}-${i + 1}`,
        color: COLORS[i % COLORS.length],
        ...(nested ? { parent_id: tops[i % tops.length] } : {}),
      });
      labels.push(label.id);
      if (!nested) tops.push(label.id);
    }
  });
  const cycles: string[] = [];
  runBatch(ctx, () => {
    for (let i = 0; i < CYCLES; i += 1) {
      const start = addDays(PERF_BASE_DATE, 1 + 14 * i);
      cycles.push(createCycle(ctx, { project_id: projectId, name: `Sprint ${i + 1}`, start_date: start, end_date: addDays(start, 13) }).id);
    }
  });
  const modules: string[] = [];
  runBatch(ctx, () => {
    for (let i = 0; i < MODULES; i += 1) {
      const start = addDays(PERF_BASE_DATE, pickIndex(rng, 60));
      modules.push(
        createModule(ctx, {
          project_id: projectId,
          name: `Module ${i + 1}`,
          status: i % 5 === 0 ? "in_progress" : "planned",
          lead_actor_id: pick(rng, actors),
          member_ids: sample(rng, actors, 1 + pickIndex(rng, 3)),
          start_date: start,
          target_date: addDays(start, 30 + pickIndex(rng, 60)),
        }).id,
      );
    }
  });
  return { labels, cycles, modules, actors };
}

type ItemRef = { id: string; priority: Priority };

type ProjectSeed = { projectId: string; total: number; taxonomy: Taxonomy | null; actors: string[]; refs: ItemRef[] };

function seedItems(ctx: TesseraContext, rng: Rng, seed: ProjectSeed, label: string, onProgress: (message: string) => void): void {
  const states = listStates(ctx, seed.projectId);
  const stateByName = new Map(states.map((state) => [state.name, state]));
  const stateRows = STATES.map((entry) => stateByName.get(entry.name) ?? states[0]);
  const weights = STATES.map((entry) => entry.weight);
  const roots: string[] = [];
  const taxonomy = seed.taxonomy;
  for (let from = 0; from < seed.total; from += BATCH) {
    const to = Math.min(seed.total, from + BATCH);
    runBatch(ctx, () => {
      for (let n = from; n < to; n += 1) {
        const stateIndex = weighted(rng, weights);
        const state = stateRows[stateIndex];
        const open = stateIndex <= 2;
        const priority = PRIORITIES[weighted(rng, PRIORITY_WEIGHTS)] as Priority;
        const start = rng() < 0.5 ? addDays(PERF_BASE_DATE, pickIndex(rng, 120) - 20) : null;
        const target = start !== null && rng() < 0.8 ? addDays(start, 3 + pickIndex(rng, 40)) : null;
        const parent = roots.length > 0 && rng() < 0.08 ? pick(rng, roots) : undefined;
        const assignees = rng() < 0.7 ? sample(rng, seed.actors, 1 + pickIndex(rng, 2)) : [];
        const created = createWorkItem(ctx, {
          project_id: seed.projectId,
          name: itemName(rng, n + 1),
          description_md: rng() < 0.6 ? itemBody(rng) : "",
          ...(state ? { state_id: state.id } : {}),
          priority,
          ...(parent ? { parent_id: parent } : {}),
          ...(assignees.length > 0 ? { assignee_ids: assignees } : {}),
          ...(start ? { start_date: start } : {}),
          ...(target ? { target_date: target } : {}),
          ...(taxonomy && rng() < 0.6 ? { label_ids: sample(rng, taxonomy.labels, 1 + pickIndex(rng, 3)) } : {}),
          ...(taxonomy && rng() < 0.25 ? { module_ids: sample(rng, taxonomy.modules, 1 + pickIndex(rng, 2)) } : {}),
          ...(taxonomy && open && rng() < 0.3 ? { cycle_id: pick(rng, taxonomy.cycles) } : {}),
        });
        seed.refs.push({ id: created.id, priority });
        if (!parent) roots.push(created.id);
      }
    });
    onProgress(`${label}: ${to}/${seed.total} work items`);
  }
}

function seedRelations(ctx: TesseraContext, rng: Rng, refs: readonly ItemRef[], total: number, onProgress: (message: string) => void): void {
  let made = 0;
  while (made < total) {
    const batchEnd = Math.min(total, made + BATCH);
    runBatch(ctx, () => {
      while (made < batchEnd) {
        const a = pick(rng, refs).id;
        const b = pick(rng, refs).id;
        made += 1;
        if (a === b) continue;
        try {
          addRelation(ctx, { work_item_id: a, related_work_item_id: b, relation_type: pick(rng, RELATION_TYPES) });
        } catch (err) {
          // A refused pair (archived or the like) just costs one relation fewer.
          if (!isTrackerError(err)) throw err;
        }
      }
    });
  }
  onProgress(`relations: ${total}`);
}

/** Adds priority changes until the activity table holds `target` rows; each change logs one row. */
function topUpActivity(ctx: TesseraContext, rng: Rng, refs: ItemRef[], target: number, onProgress: (message: string) => void): void {
  let last = -1;
  for (let rows = activityCount(ctx); rows < target && rows !== last; rows = activityCount(ctx)) {
    last = rows;
    runBatch(ctx, () => {
      for (let i = 0; i < BATCH; i += 1) {
        const ref = pick(rng, refs);
        const next = PRIORITIES[(PRIORITIES.indexOf(ref.priority) + 1) % PRIORITIES.length] as Priority;
        updateWorkItem(ctx, ref.id, { priority: next });
        ref.priority = next;
      }
    });
  }
  onProgress(`activity: ${activityCount(ctx)} rows`);
}

/**
 * Builds the perf workspace. Idempotent on `identifier`: when that project
 * already exists nothing is written. The caller's actor is the creator; use
 * the user actor.
 */
export function seedPerf(callerCtx: TesseraContext, options: SeedPerfOptions): SeedPerfResult {
  const identifier = (options.identifier ?? "PERF").toUpperCase();
  const projects = options.projects ?? 4;
  const otherItems = options.other_items ?? Math.round(options.items / 5);
  const progress = options.onProgress ?? (() => {});
  try {
    const existing = getProject(callerCtx, identifier);
    return { created: false, project_id: existing.id, counts: countsOf(callerCtx) };
  } catch (err) {
    if (!isTrackerError(err) || err.code !== "NOT_FOUND") throw err;
  }
  const ctx = seededContext(callerCtx);
  const rng = mulberry32(options.seed ?? 11);
  const main = createProject(ctx, { name: "Performance", identifier });
  progress(`project ${identifier} created`);
  const taxonomy = seedTaxonomy(ctx, rng, main.id);
  progress(`taxonomy: ${taxonomy.labels.length} labels, ${taxonomy.cycles.length} cycles, ${taxonomy.modules.length} modules`);
  const refs: ItemRef[] = [];
  seedItems(ctx, rng, { projectId: main.id, total: options.items, taxonomy, actors: taxonomy.actors, refs }, identifier, progress);
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let p = 0; p < projects; p += 1) {
    const small = createProject(ctx, { name: `Performance ${letters[p] ?? p + 1}`, identifier: `${identifier}${letters[p] ?? p + 1}` });
    const share = Math.floor(otherItems / projects) + (p < otherItems % projects ? 1 : 0);
    seedItems(ctx, rng, { projectId: small.id, total: share, taxonomy: null, actors: taxonomy.actors, refs }, small.identifier, progress);
  }
  seedRelations(ctx, rng, refs, Math.round(options.items * 0.3), progress);
  const commentTotal = Math.round(options.items * 0.5);
  inBatches(ctx, commentTotal, (i) => {
    createComment(ctx, pick(rng, refs).id, { body_md: `${pick(rng, SENTENCES)} (${i + 1})` });
  });
  progress(`comments: ${commentTotal}`);
  topUpActivity(ctx, rng, refs, Math.round(options.items * 3), progress);
  return { created: true, project_id: main.id, counts: countsOf(ctx) };
}

function countsOf(ctx: TesseraContext): SeedPerfResult["counts"] {
  return {
    projects: tableCount(ctx, "project"),
    work_items: tableCount(ctx, "work_item"),
    labels: tableCount(ctx, "label"),
    actors: tableCount(ctx, "actor"),
    cycles: tableCount(ctx, "cycle"),
    modules: tableCount(ctx, "module"),
    relations: tableCount(ctx, "work_item_relation"),
    comments: tableCount(ctx, "comment"),
    activity: activityCount(ctx),
  };
}
