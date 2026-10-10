/**
 * Demo data (docs/contracts/service-api.md "seed.ts"): the WEB project
 * ("Website") with six labels (two nested), forty work items spread across
 * states, priorities, labels, assignees, parents, dates and descriptions, a
 * current and an upcoming cycle, two modules with members and a link, one
 * project view and one workspace view. Everything goes through the service
 * functions so every invariant holds and every row has activity and FTS.
 * Idempotent: when a project with identifier WEB exists, it is returned as is.
 * Dates are relative to `ctx.today()` so the current cycle is always current.
 */
import { ASSISTANT_ACTOR_ID, USER_ACTOR_ID } from "./actors";
import { withActor, type TesseraContext } from "./core/context";
import { isTrackerError } from "./core/errors";
import { addDays } from "./core/time";
import { withTx } from "./core/tx";
import { createCycle } from "./cycles";
import { createLabel } from "./labels";
import { addModuleLink, createModule } from "./modules";
import { createProject, getProject, type Project } from "./projects";
import { listStates } from "./states";
import type { PaletteColor, Priority } from "./types";
import { createView } from "./views";
import { createWorkItem } from "./work-items";

export const DEMO_PROJECT = { name: "Website", identifier: "WEB" } as const;

type DemoActor = "user" | "assistant";
type DemoState = "Backlog" | "Todo" | "In Progress" | "Done" | "Cancelled";
type DemoLabel = "Frontend" | "Backend" | "Design" | "Bug" | "Accessibility" | "API";
type DemoCycle = "current" | "upcoming";
type DemoModule = "Marketing site" | "Checkout";

type DemoLabelSpec = { name: DemoLabel; color: PaletteColor; parent?: DemoLabel };

type DemoItemSpec = {
  /** Handle other items use as `parent`. */
  ref?: string;
  name: string;
  description?: string;
  state: DemoState;
  priority?: Priority;
  labels?: DemoLabel[];
  assignees?: DemoActor[];
  parent?: string;
  /** Days from today; negative is the past. */
  start?: number;
  target?: number;
  cycle?: DemoCycle;
  modules?: DemoModule[];
  /** Who creates the item; the calling actor when omitted. */
  creator?: DemoActor;
};

const ACTOR_IDS: Record<DemoActor, string> = { user: USER_ACTOR_ID, assistant: ASSISTANT_ACTOR_ID };

/** Six labels; Accessibility and API are children. */
const DEMO_LABELS: readonly DemoLabelSpec[] = [
  { name: "Frontend", color: "blue" },
  { name: "Backend", color: "green" },
  { name: "Design", color: "pink" },
  { name: "Bug", color: "red" },
  { name: "Accessibility", color: "purple", parent: "Frontend" },
  { name: "API", color: "teal", parent: "Backend" },
];

/** Current cycle spans today; the upcoming one starts the day after it ends. */
const DEMO_CYCLES: Record<DemoCycle, { name: string; start: number; end: number; description: string }> = {
  current: { name: "Sprint 12", start: -6, end: 7, description: "Landing page polish and the first checkout endpoints." },
  upcoming: { name: "Sprint 13", start: 8, end: 21, description: "Payments, pricing experiments and public API hardening." },
};

const DEMO_MODULES: readonly {
  name: DemoModule;
  description: string;
  status: "planned" | "in_progress";
  lead: DemoActor;
  members: DemoActor[];
  start: number;
  target: number;
  link?: { title: string; url: string };
}[] = [
  {
    name: "Marketing site",
    description: "Everything a visitor sees before signing up: landing page, pricing, blog.",
    status: "in_progress",
    lead: "user",
    members: ["user", "assistant"],
    start: -12,
    target: 20,
    link: { title: "Brand guidelines", url: "https://example.com/brand-guidelines" },
  },
  {
    name: "Checkout",
    description: "Cart, address, payment and confirmation.",
    status: "planned",
    lead: "assistant",
    members: ["assistant"],
    start: -2,
    target: 35,
  },
];

/** Forty items; parents come before their children. */
const DEMO_ITEMS: readonly DemoItemSpec[] = [
  {
    ref: "landing",
    name: "Redesign landing page",
    description: "## Goal\n\nA faster, clearer landing page.\n\n- [x] Hero section\n- [ ] Navigation\n- [ ] Testimonials",
    state: "In Progress",
    priority: "high",
    labels: ["Design", "Frontend"],
    assignees: ["user"],
    start: -10,
    target: 12,
    modules: ["Marketing site"],
  },
  {
    ref: "checkout",
    name: "Checkout flow v2",
    description: "Replace the single-page checkout with cart, address and payment steps.",
    state: "Todo",
    priority: "urgent",
    labels: ["Backend", "Frontend"],
    assignees: ["assistant"],
    start: -2,
    target: 20,
    cycle: "current",
    modules: ["Checkout"],
  },
  { ref: "a11y", name: "Accessibility audit", state: "Backlog", priority: "medium", labels: ["Accessibility"], target: 30 },
  {
    name: "Hero section layout",
    state: "Done",
    priority: "high",
    labels: ["Design"],
    assignees: ["user"],
    parent: "landing",
    start: -9,
    target: -3,
    modules: ["Marketing site"],
  },
  {
    name: "Responsive navigation",
    description: "Collapse the menu below 768px and keep the sign-up button visible.",
    state: "In Progress",
    priority: "medium",
    labels: ["Frontend"],
    assignees: ["user", "assistant"],
    parent: "landing",
    start: -5,
    target: 2,
    cycle: "current",
    modules: ["Marketing site"],
  },
  { name: "Testimonials carousel", state: "Todo", priority: "low", labels: ["Frontend", "Design"], assignees: ["assistant"], parent: "landing", target: 5, cycle: "current" },
  { name: "Landing page copy review", state: "Backlog", labels: ["Design"], parent: "landing" },
  {
    name: "Cart summary API",
    description: "`GET /api/cart` returns line items, totals and applied discounts.",
    state: "In Progress",
    priority: "urgent",
    labels: ["API", "Backend"],
    assignees: ["assistant"],
    parent: "checkout",
    start: -4,
    target: 3,
    cycle: "current",
    modules: ["Checkout"],
    creator: "assistant",
  },
  { name: "Payment provider integration", state: "Todo", priority: "urgent", labels: ["Backend"], assignees: ["assistant"], parent: "checkout", target: 9, cycle: "upcoming", modules: ["Checkout"] },
  { name: "Address form validation", state: "Todo", priority: "high", labels: ["Frontend"], assignees: ["user"], parent: "checkout", target: 4, cycle: "current", modules: ["Checkout"] },
  { name: "Order confirmation email", state: "Backlog", priority: "medium", labels: ["Backend"], parent: "checkout", modules: ["Checkout"] },
  { name: "Keyboard navigation for menus", state: "Backlog", priority: "medium", labels: ["Accessibility", "Frontend"], parent: "a11y" },
  { name: "Colour contrast fixes", state: "Backlog", priority: "low", labels: ["Accessibility", "Design"], parent: "a11y" },
  {
    name: "Broken image on pricing page",
    description: "The comparison table hero image returns 404 since the CDN move.",
    state: "In Progress",
    priority: "urgent",
    labels: ["Bug", "Frontend"],
    assignees: ["user"],
    target: -2,
    cycle: "current",
    creator: "assistant",
  },
  { name: "Login form submits twice on Enter", state: "Todo", priority: "high", labels: ["Bug", "Frontend"], assignees: ["assistant"], target: -5, cycle: "current" },
  { name: "Search returns deleted articles", state: "Todo", priority: "high", labels: ["Bug", "Backend"], assignees: ["user"], target: 1, cycle: "current" },
  { name: "Footer links open in same tab", state: "Backlog", priority: "low", labels: ["Bug"] },
  { name: "Date picker ignores timezone", state: "Done", priority: "medium", labels: ["Bug", "Frontend"], assignees: ["user"], start: -14, target: -8 },
  { name: "Slow blog index query", state: "Done", priority: "high", labels: ["Bug", "Backend"], assignees: ["assistant"], start: -12, target: -7, creator: "assistant" },
  { name: "Newsletter double opt-in email missing", state: "Cancelled", priority: "medium", labels: ["Bug", "Backend"], target: -4 },
  { name: "Typo in 404 page", state: "Done", labels: ["Bug"], assignees: ["user"] },
  { name: "Add dark mode", description: "Respect `prefers-color-scheme` and add a toggle in the footer.", state: "Backlog", priority: "medium", labels: ["Frontend", "Design"] },
  { name: "Blog RSS feed", state: "Backlog", priority: "low", labels: ["Backend"] },
  { name: "Sitemap generation", state: "Backlog", priority: "low", labels: ["Backend", "API"] },
  { name: "Image CDN migration", state: "Backlog", priority: "medium", labels: ["Backend"], target: 25 },
  { name: "Analytics dashboard for marketing", state: "Backlog", labels: ["Backend"] },
  { name: "Cookie consent banner", state: "Todo", priority: "medium", labels: ["Frontend"], assignees: ["assistant"], target: 6, cycle: "current" },
  { name: "Pricing page A/B test", state: "Todo", priority: "medium", labels: ["Design", "Frontend"], assignees: ["user"], target: 14, cycle: "upcoming", modules: ["Marketing site"] },
  { name: "Customer logos section", state: "Todo", priority: "low", labels: ["Design"], cycle: "upcoming", modules: ["Marketing site"] },
  { name: "Blog author pages", state: "Todo", priority: "low", labels: ["Frontend"], assignees: ["assistant"], target: 18, cycle: "upcoming" },
  { name: "Rate limiting for public API", state: "Todo", priority: "high", labels: ["API", "Backend"], assignees: ["assistant"], target: 11, cycle: "upcoming", creator: "assistant" },
  { name: "Open Graph previews", state: "In Progress", priority: "medium", labels: ["Frontend"], assignees: ["user"], start: -3, target: 3, cycle: "current", modules: ["Marketing site"] },
  { name: "Contact form spam filter", state: "In Progress", priority: "high", labels: ["Backend"], assignees: ["assistant"], start: -6, target: 0, cycle: "current", creator: "assistant" },
  { name: "Upgrade framework to latest", state: "In Progress", priority: "medium", labels: ["Backend", "Frontend"], assignees: ["user", "assistant"], start: -8, target: 5, cycle: "current" },
  { name: "Set up uptime monitoring", state: "Done", priority: "medium", labels: ["Backend"], assignees: ["assistant"], start: -20, target: -15, creator: "assistant" },
  { name: "Migrate fonts to self-hosting", state: "Done", priority: "low", labels: ["Frontend"], assignees: ["user"], start: -18, target: -12 },
  { name: "Privacy policy update", state: "Done", priority: "high", labels: ["Design"], assignees: ["user"], target: -9 },
  { name: "Write onboarding guide", description: "A short guide for new contributors.", state: "Done", assignees: ["assistant"], creator: "assistant" },
  { name: "Chatbot widget evaluation", state: "Cancelled", priority: "low", labels: ["Frontend"] },
  { name: "Animated page transitions", state: "Cancelled", labels: ["Design", "Frontend"], assignees: ["user"] },
];

const DEMO_VIEWS = {
  project: { name: "Open bugs", description: "Bugs that are not done yet, as a board by state." },
  workspace: { name: "High priority everywhere", description: "Urgent and high priority items across all projects." },
} as const;

/** What seedDemo creates, derived from the specs above so it never drifts. */
export const SEED_SUMMARY = {
  project: DEMO_PROJECT,
  labels: DEMO_LABELS.length,
  child_labels: DEMO_LABELS.filter((label) => label.parent !== undefined).length,
  work_items: DEMO_ITEMS.length,
  cycles: Object.keys(DEMO_CYCLES).length,
  modules: DEMO_MODULES.length,
  module_links: DEMO_MODULES.filter((module) => module.link !== undefined).length,
  views: Object.keys(DEMO_VIEWS).length,
  description:
    "Demo project WEB (Website): 6 labels (2 nested), 40 work items across states, priorities, labels, assignees, parents and dates, " +
    "a current and an upcoming cycle, 2 modules with members and a link, 1 project view and 1 workspace view.",
} as const;

export type SeedDemoResult = { project: Project; created: boolean };

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function findDemoProject(ctx: TesseraContext): Project | null {
  try {
    return getProject(ctx, DEMO_PROJECT.identifier);
  } catch (err) {
    if (isTrackerError(err) && err.code === "NOT_FOUND") return null;
    throw err;
  }
}

function seedLabels(ctx: TesseraContext, projectId: string): Map<DemoLabel, string> {
  const ids = new Map<DemoLabel, string>();
  for (const spec of DEMO_LABELS) {
    const parentId = spec.parent === undefined ? undefined : ids.get(spec.parent);
    if (spec.parent !== undefined && parentId === undefined) throw new Error(`seed: parent label ${spec.parent} must be listed before ${spec.name}`);
    const row = createLabel(ctx, { project_id: projectId, name: spec.name, color: spec.color, parent_id: parentId });
    ids.set(spec.name, row.id);
  }
  return ids;
}

function seedCycles(ctx: TesseraContext, projectId: string, today: string): Map<DemoCycle, string> {
  const ids = new Map<DemoCycle, string>();
  for (const [key, spec] of Object.entries(DEMO_CYCLES) as [DemoCycle, (typeof DEMO_CYCLES)[DemoCycle]][]) {
    const row = createCycle(ctx, {
      project_id: projectId,
      name: spec.name,
      description_md: spec.description,
      start_date: addDays(today, spec.start),
      end_date: addDays(today, spec.end),
    });
    ids.set(key, row.id);
  }
  return ids;
}

function seedModules(ctx: TesseraContext, projectId: string, today: string): Map<DemoModule, string> {
  const ids = new Map<DemoModule, string>();
  for (const spec of DEMO_MODULES) {
    const row = createModule(ctx, {
      project_id: projectId,
      name: spec.name,
      description_md: spec.description,
      status: spec.status,
      lead_actor_id: ACTOR_IDS[spec.lead],
      member_ids: spec.members.map((member) => ACTOR_IDS[member]),
      start_date: addDays(today, spec.start),
      target_date: addDays(today, spec.target),
    });
    if (spec.link) addModuleLink(ctx, row.id, spec.link);
    ids.set(spec.name, row.id);
  }
  return ids;
}

type Vocabulary = {
  states: Map<string, string>;
  labels: Map<DemoLabel, string>;
  cycles: Map<DemoCycle, string>;
  modules: Map<DemoModule, string>;
};

function requireId<K>(map: Map<K, string>, key: K, what: string): string {
  const id = map.get(key);
  if (id === undefined) throw new Error(`seed: unknown ${what} ${String(key)}`);
  return id;
}

function seedItems(ctx: TesseraContext, projectId: string, today: string, vocab: Vocabulary): string[] {
  const byRef = new Map<string, string>();
  const ids: string[] = [];
  const contexts: Record<DemoActor, TesseraContext> = { user: withActor(ctx, USER_ACTOR_ID), assistant: withActor(ctx, ASSISTANT_ACTOR_ID) };
  for (const spec of DEMO_ITEMS) {
    const creator = spec.creator === undefined ? ctx : contexts[spec.creator];
    const item = createWorkItem(creator, {
      project_id: projectId,
      name: spec.name,
      description_md: spec.description,
      state_id: requireId(vocab.states, spec.state, "state"),
      priority: spec.priority,
      parent_id: spec.parent === undefined ? undefined : requireId(byRef, spec.parent, "parent ref"),
      cycle_id: spec.cycle === undefined ? undefined : requireId(vocab.cycles, spec.cycle, "cycle"),
      label_ids: (spec.labels ?? []).map((name) => requireId(vocab.labels, name, "label")),
      module_ids: (spec.modules ?? []).map((name) => requireId(vocab.modules, name, "module")),
      assignee_ids: (spec.assignees ?? []).map((who) => ACTOR_IDS[who]),
      start_date: spec.start === undefined ? undefined : addDays(today, spec.start),
      target_date: spec.target === undefined ? undefined : addDays(today, spec.target),
    });
    if (spec.ref !== undefined) byRef.set(spec.ref, item.id);
    ids.push(item.id);
  }
  return ids;
}

function seedViews(ctx: TesseraContext, projectId: string, labels: Map<DemoLabel, string>): void {
  createView(ctx, {
    project_id: projectId,
    name: DEMO_VIEWS.project.name,
    description: DEMO_VIEWS.project.description,
    filters: { labels: [requireId(labels, "Bug", "label")], state_group: ["backlog", "unstarted", "started"] },
    display: { layout: "board", group_by: "state" },
    logo: { icon: "Bug", color: "red" },
  });
  createView(ctx, {
    project_id: null,
    name: DEMO_VIEWS.workspace.name,
    description: DEMO_VIEWS.workspace.description,
    filters: { priority: ["urgent", "high"] },
    display: { layout: "table", order_by: "priority" },
    logo: { icon: "Fire", color: "orange" },
  });
}

/** Project states by name; createProject seeded them. */
function stateIdsByName(ctx: TesseraContext, projectId: string): Map<string, string> {
  return new Map(listStates(ctx, projectId).map((row) => [row.name, row.id]));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Creates the demo project once; returns the existing one (and `created: false`) when WEB already exists. */
export function seedDemo(ctx: TesseraContext): SeedDemoResult {
  const existing = findDemoProject(ctx);
  if (existing) return { project: existing, created: false };
  return withTx(ctx, () => {
    // Another process may have seeded between the check above and BEGIN IMMEDIATE.
    const raced = findDemoProject(ctx);
    if (raced) return { project: raced, created: false };
    const today = ctx.today();
    const created = createProject(ctx, {
      name: DEMO_PROJECT.name,
      identifier: DEMO_PROJECT.identifier,
      description_md: "The public website: marketing pages, blog and checkout.",
      logo: { icon: "Globe", color: "blue" },
    });
    const vocab: Vocabulary = {
      states: stateIdsByName(ctx, created.id),
      labels: seedLabels(ctx, created.id),
      cycles: seedCycles(ctx, created.id, today),
      modules: seedModules(ctx, created.id, today),
    };
    seedItems(ctx, created.id, today, vocab);
    seedViews(ctx, created.id, vocab.labels);
    return { project: getProject(ctx, created.id), created: true };
  });
}
