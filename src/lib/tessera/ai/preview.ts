/**
 * Proposal preview (decision 33): ids become names, updates show the current
 * value beside the proposed one, and nothing is written. An id that does not
 * resolve is labelled Unknown; Apply then fails with NOT_FOUND.
 *
 * Enum words are the same ones the UI shows (priority, state group, module
 * status, palette). Those maps live in components, which this engine file
 * cannot import, so the words are copied here.
 */
import { eq } from "drizzle-orm";
import { getActor } from "../actors";
import type { TesseraContext } from "../core/context";
import { validateInput, validation } from "../core/errors";
import { isId } from "../core/ids";
import { formatKey } from "../core/keys";
import { getCycle } from "../cycles";
import { actor, cycle, estimate_point, label, module_link, moduleTable, project, state, view, work_item, work_item_link } from "../db/schema";
import { getLabel } from "../labels";
import { getModule } from "../modules";
import { getProjectRow } from "../projects";
import { getState } from "../states";
import { getTool } from "../tools/registry";
import type { PaletteColor, Priority, ProposalPreview, StateGroup } from "../types";
import { getView } from "../views";
import { getWorkItem } from "../work-items";

type TargetType = NonNullable<ProposalPreview["target"]>["type"];
type Field = ProposalPreview["fields"][number];

/** activity-text.ts PRIORITY_WORDS. */
const PRIORITY_WORDS: Record<Priority, string> = { none: "None", low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };

/** StateControl GROUP_LABEL, the words on the work item. */
const STATE_GROUP_WORDS: Record<StateGroup, string> = {
  backlog: "Backlog",
  unstarted: "Not started",
  started: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  triage: "Triage",
};

/** module-format.ts MODULE_STATUS_LABEL. */
const MODULE_STATUS_WORDS: Record<string, string> = {
  backlog: "Backlog",
  planned: "Planned",
  in_progress: "In progress",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** palette-labels.ts PALETTE_COLOR_LABELS. */
const COLOR_WORDS: Record<PaletteColor, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  teal: "Teal",
  cyan: "Cyan",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  gray: "Gray",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const FIELD_LABEL: Record<string, string> = {
  name: "Title",
  description_md: "Description",
  description: "Description",
  state_id: "State",
  state_group: "State group",
  priority: "Priority",
  parent_id: "Parent",
  cycle_id: "Cycle",
  to_cycle_id: "To cycle",
  estimate_point_id: "Estimate",
  start_date: "Start date",
  target_date: "Target date",
  end_date: "End date",
  project_id: "Project",
  label_id: "Label",
  label_ids: "Labels",
  module_id: "Module",
  module_ids: "Modules",
  assignee_ids: "Assignees",
  actor_id: "Actor",
  actor_ids: "Assignees",
  lead_actor_id: "Lead",
  member_ids: "Members",
  work_item_id: "Work item",
  work_item_ids: "Work items",
  ids: "Work items",
  view_id: "View",
  link_id: "Link",
  color: "Colour",
  status: "Status",
  identifier: "Identifier",
  filters: "Filters",
  display: "Display",
  features: "Features",
  source: "Source",
  is_default: "Default",
  before_id: "Before",
  after_id: "After",
  group_by: "Group by",
  sub_group_by: "Sub-group",
  value: "Value",
  from_value: "From",
  sub_value: "Sub-value",
  sub_from_value: "Sub-from",
  title: "Title",
  url: "URL",
};

const ID_KIND: Record<string, "state" | "label" | "actor" | "cycle" | "module" | "project" | "work_item" | "view" | "link" | "estimate"> = {
  state_id: "state",
  label_id: "label",
  label_ids: "label",
  assignee_ids: "actor",
  actor_ids: "actor",
  actor_id: "actor",
  lead_actor_id: "actor",
  member_ids: "actor",
  cycle_id: "cycle",
  to_cycle_id: "cycle",
  module_id: "module",
  module_ids: "module",
  project_id: "project",
  work_item_id: "work_item",
  ids: "work_item",
  work_item_ids: "work_item",
  parent_id: "work_item",
  before_id: "work_item",
  after_id: "work_item",
  view_id: "view",
  link_id: "link",
  estimate_point_id: "estimate",
};

const TARGET_KEY: Record<TargetType, string> = {
  work_item: "work_item_id",
  project: "project_id",
  state: "state_id",
  label: "label_id",
  cycle: "cycle_id",
  module: "module_id",
  view: "view_id",
  actor: "actor_id",
  link: "link_id",
};

const KIND_NOUN: Record<TargetType, string> = {
  work_item: "work item",
  project: "project",
  state: "state",
  label: "label",
  cycle: "cycle",
  module: "module",
  view: "view",
  actor: "actor",
  link: "link",
};

const GROUP_KIND: Record<string, (typeof ID_KIND)[string] | "state_group" | "priority"> = {
  state: "state",
  state_group: "state_group",
  priority: "priority",
  labels: "label",
  assignees: "actor",
  created_by: "actor",
  module: "module",
  cycle: "cycle",
};

function unknown(id: string): string {
  return `Unknown (${id.slice(0, 8)})`;
}

function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? field.replace(/_ids?$/, "").replace(/_/g, " ").replace(/^\w/, (char) => char.toUpperCase());
}

function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${Number(match[3])}, ${match[1]}` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** First 200 characters, then the full length, so a long body stays readable. */
function formatDescription(text: string): string | null {
  if (text.length === 0) return null;
  return `${text.slice(0, 200)} (${text.length} characters)`;
}

class Names {
  missing = false;
  private readonly cache = new Map<string, string | null>();

  constructor(private readonly ctx: TesseraContext) {}

  one(kind: string, id: string): string {
    const key = `${kind}:${id}`;
    let label = this.cache.get(key);
    if (label === undefined) {
      label = this.lookup(kind, id);
      this.cache.set(key, label);
    }
    if (label === null) {
      this.missing = true;
      return unknown(id);
    }
    return label;
  }

  many(kind: string, ids: readonly string[]): string | null {
    if (ids.length === 0) return null;
    return ids.map((id) => this.one(kind, id)).join(", ");
  }

  /** Project row for the expected-key note; null when the id does not exist. */
  projectRow(id: string): { identifier: string; name: string; next_sequence: number } | null {
    return (
      this.ctx.db
        .select({ identifier: project.identifier, name: project.name, next_sequence: project.next_sequence })
        .from(project)
        .where(eq(project.id, id))
        .get() ?? null
    );
  }

  private lookup(kind: string, id: string): string | null {
    switch (kind) {
      case "state": {
        const row = this.ctx.db.select({ name: state.name }).from(state).where(eq(state.id, id)).get();
        return row?.name ?? null;
      }
      case "label": {
        const row = this.ctx.db.select({ name: label.name }).from(label).where(eq(label.id, id)).get();
        return row?.name ?? null;
      }
      case "actor": {
        const row = this.ctx.db.select({ name: actor.name }).from(actor).where(eq(actor.id, id)).get();
        return row?.name ?? null;
      }
      case "cycle": {
        const row = this.ctx.db.select({ name: cycle.name }).from(cycle).where(eq(cycle.id, id)).get();
        return row?.name ?? null;
      }
      case "module": {
        const row = this.ctx.db.select({ name: moduleTable.name }).from(moduleTable).where(eq(moduleTable.id, id)).get();
        return row?.name ?? null;
      }
      case "project": {
        const row = this.projectRow(id);
        return row ? `${row.identifier} ${row.name}` : null;
      }
      case "work_item": {
        const row = this.ctx.db
          .select({ name: work_item.name, sequence_id: work_item.sequence_id, identifier: project.identifier })
          .from(work_item)
          .innerJoin(project, eq(project.id, work_item.project_id))
          .where(eq(work_item.id, id))
          .get();
        return row ? `${formatKey(row.identifier, row.sequence_id)} ${row.name}` : null;
      }
      case "view": {
        const row = this.ctx.db.select({ name: view.name }).from(view).where(eq(view.id, id)).get();
        return row?.name ?? null;
      }
      case "link": {
        const onItem = this.ctx.db.select({ title: work_item_link.title }).from(work_item_link).where(eq(work_item_link.id, id)).get();
        if (onItem) return onItem.title;
        const onModule = this.ctx.db.select({ title: module_link.title }).from(module_link).where(eq(module_link.id, id)).get();
        return onModule?.title ?? null;
      }
      case "estimate": {
        const row = this.ctx.db.select({ value: estimate_point.value }).from(estimate_point).where(eq(estimate_point.id, id)).get();
        return row?.value ?? null;
      }
      default:
        return null;
    }
  }
}

function entityKind(name: string): TargetType | null {
  if (name.includes("link")) return "link";
  if (name === "add_work_items_to_cycle" || name === "remove_work_items_from_cycle" || name === "transfer_cycle_work_items") return "cycle";
  if (name === "add_work_items_to_module" || name === "remove_work_items_from_module" || name === "set_module_members") return "module";
  if (name.includes("work_item") || name === "set_labels" || name === "set_modules" || name === "set_assignees" || name.includes("subscribe")) return "work_item";
  if (name.includes("project")) return "project";
  if (name.includes("state")) return "state";
  if (name.includes("label")) return "label";
  if (name.includes("cycle")) return "cycle";
  if (name.includes("module")) return "module";
  if (name.includes("view")) return "view";
  if (name.includes("actor")) return "actor";
  return null;
}

function creating(name: string): boolean {
  return name.startsWith("create_") || name === "register_actor" || name === "add_link" || name === "add_module_link";
}

function createTargetLabel(data: Record<string, unknown>, kind: TargetType): string {
  const name = typeof data.name === "string" ? data.name : typeof data.title === "string" ? data.title : null;
  if (kind === "project" && name !== null && typeof data.identifier === "string") return `${data.identifier} ${name}`;
  return name ?? KIND_NOUN[kind];
}

function tryCall<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function snapshotOf(ctx: TesseraContext, kind: TargetType, id: string): Record<string, unknown> | null {
  const row = tryCall(() => {
    switch (kind) {
      case "work_item":
        return getWorkItem(ctx, id);
      case "project":
        return getProjectRow(ctx, id);
      case "state":
        return getState(ctx, id);
      case "label":
        return getLabel(ctx, id);
      case "cycle":
        return getCycle(ctx, id);
      case "module":
        return getModule(ctx, id);
      case "view":
        return getView(ctx, id);
      case "actor":
        return getActor(ctx, id);
      case "link": {
        const onItem = ctx.db.select().from(work_item_link).where(eq(work_item_link.id, id)).get();
        if (onItem) return onItem;
        return ctx.db.select().from(module_link).where(eq(module_link.id, id)).get() ?? null;
      }
      default:
        return null;
    }
  });
  return row === null ? null : { ...row };
}

function currentValue(kind: TargetType, snap: Record<string, unknown> | null, field: string): unknown {
  if (snap === null) return undefined;
  if (field === "actor_ids" && kind === "module") return snap.member_ids;
  if (field === "actor_ids" && kind === "work_item") return snap.assignee_ids;
  if (field in snap) return snap[field];
  return undefined;
}

function formatScalar(names: Names, field: string, value: unknown, siblings: Record<string, unknown>): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const kind = ID_KIND[field];
    if (kind !== undefined && value.every((item) => typeof item === "string")) return names.many(kind, value);
    return value.map((item) => String(item)).join(", ") || null;
  }
  if (isRecord(value)) {
    const text = JSON.stringify(value);
    return text.length <= 500 ? text : `${text.slice(0, 500)} (${text.length} characters)`;
  }
  if (typeof value !== "string") return String(value);
  if (field === "description_md" || field === "description") return formatDescription(value);
  if (field === "priority" || (siblings.group_by === "priority" && (field === "value" || field === "from_value"))) {
    return PRIORITY_WORDS[value as Priority] ?? value;
  }
  if (field === "state_group") return STATE_GROUP_WORDS[value as StateGroup] ?? value;
  if (field === "status") return MODULE_STATUS_WORDS[value] ?? value;
  if (field === "color" && value in COLOR_WORDS) return COLOR_WORDS[value as PaletteColor];
  if (field === "start_date" || field === "target_date" || field === "end_date") return formatDate(value);
  const grouped = field === "sub_value" || field === "sub_from_value" ? siblings.sub_group_by : field === "value" || field === "from_value" ? siblings.group_by : undefined;
  if (typeof grouped === "string" && isId(value)) {
    const kind = GROUP_KIND[grouped];
    if (kind === "priority") return PRIORITY_WORDS[value as Priority] ?? value;
    if (kind === "state_group") return STATE_GROUP_WORDS[value as StateGroup] ?? value;
    if (kind !== undefined) return names.one(kind, value);
  }
  const kind = ID_KIND[field];
  if (kind !== undefined) return names.one(kind, value);
  return value;
}

function flatten(data: Record<string, unknown>, skip: ReadonlySet<string>): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [key, value] of Object.entries(data)) {
    if (skip.has(key) || value === undefined) continue;
    if (key === "patch" && isRecord(value)) {
      out.push(...flatten(value, skip));
      continue;
    }
    out.push([key, value]);
  }
  return out;
}

function notesFor(ctx: TesseraContext, name: string, data: Record<string, unknown>, names: Names, kind: TargetType | null): string[] {
  const notes: string[] = [];
  if (name === "create_work_item" && typeof data.project_id === "string") {
    const row = names.projectRow(data.project_id);
    if (row) notes.push(`Expected key ${formatKey(row.identifier, row.next_sequence)}`);
  }
  if (name.startsWith("delete_") && kind !== null) notes.push(`Deletes 1 ${KIND_NOUN[kind]}`);
  if (name === "bulk_update_work_items" && Array.isArray(data.ids)) notes.push(`Updates ${data.ids.length} work items`);
  if (name === "transfer_cycle_work_items" && typeof data.cycle_id === "string") {
    const source = tryCall(() => getCycle(ctx, data.cycle_id as string));
    if (source) notes.push(`Moves ${source.open_count} open items`);
  }
  if (names.missing) notes.push("Refers to something that does not exist");
  return notes;
}

/** Resolves `input` the way Apply would show it. Read tools and unknown tools are refused. */
export function previewTool(ctx: TesseraContext, name: string, input: unknown): ProposalPreview {
  const def = getTool(name);
  if (!def.mutates) throw validation({ rule: "not_mutating" }, "not_mutating: only a mutating tool can be proposed");
  const data = validateInput(def.input, input) as Record<string, unknown>;
  const names = new Names(ctx);
  const kind = entityKind(name);
  const isCreate = creating(name);
  let target: ProposalPreview["target"] = null;
  if (kind !== null && name !== "bulk_update_work_items") {
    if (isCreate) {
      target = { type: kind, id: null, label: createTargetLabel(data, kind) };
    } else {
      const id = data[TARGET_KEY[kind]];
      if (typeof id === "string") target = { type: kind, id, label: names.one(ID_KIND[TARGET_KEY[kind]] ?? "work_item", id) };
    }
  }
  const skip = new Set<string>(["expected_description_version"]);
  if (kind !== null && !isCreate && name !== "bulk_update_work_items") skip.add(TARGET_KEY[kind]);
  const snap = !isCreate && target?.id !== null && target !== null && /^(update_|set_|move_)/.test(name) ? snapshotOf(ctx, target.type, target.id) : null;
  const showBefore = snap !== null;
  const fields: Field[] = flatten(data, skip).map(([field, value]) => ({
    field,
    label: fieldLabel(field),
    before: showBefore && kind !== null ? formatScalar(names, field, currentValue(kind, snap, field), data) : null,
    after: formatScalar(names, field, value, data),
  }));
  const notes = notesFor(ctx, name, data, names, kind);
  return {
    title: target ? `${def.title} · ${target.label}` : def.title,
    target,
    fields,
    ...(notes.length > 0 ? { note: notes.join(". ") } : {}),
  };
}
