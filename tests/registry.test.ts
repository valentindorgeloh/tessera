/**
 * Registry contract (docs/contracts/tools.md, "Registry test"): every service
 * mutation is reachable through exactly one tool, inputs are strict and
 * documented, flags match the contract tables, describe_filters covers the
 * schemas, and the runner works end to end on an in-memory database.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { runTool, toolAction } from "@/app/actions/_run";
import * as activity from "@/lib/tessera/activity";
import * as actors from "@/lib/tessera/actors";
import * as assignees from "@/lib/tessera/assignees";
import * as changes from "@/lib/tessera/changes";
import { isTrackerError } from "@/lib/tessera/core/errors";
import * as counts from "@/lib/tessera/counts";
import * as cycles from "@/lib/tessera/cycles";
import * as filters from "@/lib/tessera/filters";
import * as labels from "@/lib/tessera/labels";
import * as links from "@/lib/tessera/links";
import * as modules from "@/lib/tessera/modules";
import * as pages from "@/lib/tessera/pages";
import * as relations from "@/lib/tessera/relations";
import * as projects from "@/lib/tessera/projects";
import {
  DEFAULT_DISPLAY,
  DisplaySchema,
  FiltersSchema,
  IntakeStatusSchema,
  LayoutSchema,
  ModuleStatusSchema,
  PaletteColorSchema,
  PrioritySchema,
  RelationTypeSchema,
  StateGroupSchema,
} from "@/lib/tessera/schemas";
import * as search from "@/lib/tessera/search";
import * as seed from "@/lib/tessera/seed";
import * as states from "@/lib/tessera/states";
import { TOOL_PHASES, type ToolDef, type ToolPhase } from "@/lib/tessera/tools/define";
import { describeFilters, type DescribeFiltersPayload } from "@/lib/tessera/tools/describe-filters";
import { getTool, listTools, registry, runToolWithContext, type ToolInput, type ToolName, type ToolOutput } from "@/lib/tessera/tools/registry";
import * as viewSettings from "@/lib/tessera/view-settings";
import * as views from "@/lib/tessera/views";
import * as workItems from "@/lib/tessera/work-items";
import { createTestContext, createTestDb } from "./helpers/db";

const TOOLS: ToolDef[] = [...registry.values()];

async function errorCode(fn: () => unknown): Promise<string> {
  try {
    await fn();
  } catch (err) {
    if (isTrackerError(err)) return err.code;
    throw err;
  }
  throw new Error("expected a TrackerError");
}

// ---------------------------------------------------------------------------
// 1. Every service mutation is bound by exactly one tool
// ---------------------------------------------------------------------------

const MUTATION_PREFIX =
  /^(create|update|delete|archive|unarchive|move|set|add|remove|transfer|restore|accept|decline|snooze|mark|lock|unlock|duplicate|reorder|subscribe|unsubscribe|run|bulk|register|touch|save|reset|seed)/;

/** Exported functions that match the prefix but are not operations; each needs a reason. */
const INTERNAL_HELPERS: Record<string, string> = {
  touchActor: "bumps last_seen for the MCP adapter on every call; writes no activity and is not an operation",
  seedProjectStates: "runs inside createProject's transaction to seed the default states",
  seedDemo: "script entry point (db:seed, mcp --init); demo data is not a tool",
};

const DOMAIN_MODULES = {
  activity,
  actors,
  assignees,
  changes,
  counts,
  cycles,
  filters,
  labels,
  links,
  modules,
  projects,
  search,
  seed,
  states,
  "view-settings": viewSettings,
  views,
  pages,
  relations,
  "work-items": workItems,
};

function mutationFunctions(mod: object): string[] {
  return Object.entries(mod)
    .filter(([name, value]) => typeof value === "function" && MUTATION_PREFIX.test(name))
    .map(([name]) => name);
}

const RUN_SOURCES = TOOLS.map((def) => ({ name: def.name, source: def.run.toString() }));

/** Tools whose run body mentions the function; the SSR transform may wrap calls as `(0, ns.fn)(...)`, so match the bare word. */
function toolsReferencing(fn: string): string[] {
  const word = new RegExp(`\\b${fn}\\b`);
  return RUN_SOURCES.filter((entry) => word.test(entry.source)).map((entry) => entry.name);
}

describe("service coverage", () => {
  for (const [moduleName, mod] of Object.entries(DOMAIN_MODULES)) {
    const fns = mutationFunctions(mod);
    describe(moduleName, () => {
      for (const fn of fns) {
        if (fn in INTERNAL_HELPERS) {
          it(`${fn} is an internal helper and not bound by any tool`, () => {
            expect(toolsReferencing(fn)).toEqual([]);
          });
        } else {
          it(`${fn} is bound by exactly one tool`, () => {
            expect(toolsReferencing(fn)).toHaveLength(1);
          });
        }
      }
    });
  }

  it("every allowlisted helper still exists", () => {
    const all = new Set(Object.values(DOMAIN_MODULES).flatMap((mod) => mutationFunctions(mod)));
    for (const name of Object.keys(INTERNAL_HELPERS)) expect(all.has(name), name).toBe(true);
  });

  it("finds mutations in every domain module", () => {
    const covered = Object.entries(DOMAIN_MODULES).filter(([, mod]) => mutationFunctions(mod).length > 0);
    expect(covered.map(([name]) => name)).toEqual(
      expect.arrayContaining(["actors", "assignees", "cycles", "labels", "links", "modules", "projects", "states", "view-settings", "views", "work-items"]),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Strict inputs, described fields
// ---------------------------------------------------------------------------

/** Walks optional / nullable / default wrappers: `.partial()` wraps described fields in an undescribed ZodOptional. */
function hasDescription(schema: z.core.$ZodType): boolean {
  let current = schema;
  for (;;) {
    const description = z.globalRegistry.get(current)?.description;
    if (typeof description === "string" && description.trim() !== "") return true;
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable || current instanceof z.ZodDefault) {
      current = current.unwrap();
    } else {
      return false;
    }
  }
}

describe("tool inputs", () => {
  for (const def of TOOLS) {
    it(`${def.name} has a strict object input with described fields`, () => {
      expect(def.input).toBeInstanceOf(z.ZodObject);
      expect(def.input._zod.def.catchall).toBeInstanceOf(z.ZodNever);
      for (const [key, field] of Object.entries(def.input.shape)) {
        expect(hasDescription(field), `${def.name}.${key} has no description`).toBe(true);
      }
    });
  }

  it("take ids; only get_work_item_by_key takes a key", () => {
    for (const def of TOOLS) {
      for (const [key, field] of Object.entries(def.input.shape)) {
        if (/(^|_)keys?$/.test(key)) expect(def.name, key).toBe("get_work_item_by_key");
        // scope_id names an entity id or the literal "workspace", so it stays a plain string;
        // get_project.project_id also accepts the project identifier such as WEB (D20).
        if (key.endsWith("_id") && key !== "scope_id" && def.name !== "get_project") {
          let inner: z.core.$ZodType = field;
          while (inner instanceof z.ZodOptional || inner instanceof z.ZodNullable) inner = inner.unwrap();
          expect(inner, `${def.name}.${key}`).toBeInstanceOf(z.ZodUUID);
        }
      }
    }
  });

  it("get_project takes a UUID or a project identifier and says so", () => {
    const field = getTool("get_project").input.shape.project_id;
    expect(field).toBeInstanceOf(z.ZodString);
    expect(field.safeParse("WEB").success).toBe(true);
    expect(field.safeParse("").success).toBe(false);
    expect(field.description).toMatch(/identifier/);
  });

  // MCP advertises `def.input` as JSON Schema through zod's Standard Schema hook (io: "input"), so both paths must convert;
  // the recursive RichFiltersSchema inside create_view / update_view used to overflow the stack there (D21).
  it("convert to JSON Schema with z.toJSONSchema and through the Standard Schema hook", () => {
    for (const def of TOOLS) {
      const direct = z.toJSONSchema(def.input, { target: "draft-2020-12" });
      expect(direct.type, def.name).toBe("object");
      expect(Object.keys(direct.properties ?? {}).sort(), def.name).toEqual(Object.keys(def.input.shape).sort());
      const standard = def.input["~standard"].jsonSchema.input({ target: "draft-2020-12" });
      expect(standard.type, def.name).toBe("object");
    }
  });

  it("advertise the rich filter tree as a $ref to a shared AND / OR / NOT / condition definition", () => {
    for (const name of ["create_view", "update_view"] as const) {
      const json = getTool(name).input["~standard"].jsonSchema.input({ target: "draft-2020-12" }) as {
        properties: Record<string, { description?: string; anyOf?: { $ref?: string; type?: string }[] }>;
        $defs?: Record<string, { anyOf?: { properties?: Record<string, unknown>; required?: string[] }[] }>;
      };
      const ref = json.properties.rich_filters.anyOf?.find((branch) => branch.$ref)?.$ref;
      expect(ref, name).toMatch(/^#\/\$defs\//);
      const node = json.$defs?.[ref!.replace("#/$defs/", "")];
      const branches = (node?.anyOf ?? []).map((branch) => branch.required ?? []);
      expect(branches, name).toEqual([["and"], ["or"], ["not"], ["field", "op"]]);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Names, titles, descriptions
// ---------------------------------------------------------------------------

describe("tool names", () => {
  it("are unique", () => {
    expect(new Set(TOOLS.map((def) => def.name)).size).toBe(TOOLS.length);
    expect(registry.size).toBe(TOOLS.length);
  });

  it("are snake_case", () => {
    for (const def of TOOLS) {
      expect(def.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(def.name).not.toContain("__");
    }
  });

  it("carry a title and a one-paragraph description", () => {
    for (const def of TOOLS) {
      expect(def.title.trim().length, def.name).toBeGreaterThan(2);
      expect(def.description.trim().length, def.name).toBeGreaterThan(30);
      expect(def.description, def.name).not.toContain("\n");
    }
  });

  it("registry keys equal tool names", () => {
    for (const [key, def] of registry) expect(key).toBe(def.name);
  });
});

// ---------------------------------------------------------------------------
// 4. Flags: destructive, core, phase, mutates
// ---------------------------------------------------------------------------

/** docs/contracts/tools.md: destructive tools besides every delete_*. */
const CONTRACT_DESTRUCTIVE = new Set([
  "transfer_cycle_work_items",
  "bulk_update_work_items",
  "move_work_item_to_project",
  "restore_work_item_version",
  "restore_page_version",
  "accept_intake_item",
  "decline_intake_item",
]);

/** The ★ tools of the P1 to P4 and P7 rows of the contract table. */
const CONTRACT_CORE = [
  "list_projects",
  "get_project",
  "create_project",
  "list_states",
  "list_labels",
  "list_actors",
  "list_work_items",
  "get_work_item",
  "get_work_item_by_key",
  "create_work_item",
  "update_work_item",
  "update_work_item_description",
  "move_work_item",
  "set_labels",
  "set_assignees",
  "list_activity",
  "list_cycles",
  "get_cycle",
  "get_cycle_progress",
  "list_modules",
  "list_views",
  "list_pages",
  "get_page",
  "list_page_backlinks",
  "create_page",
  "update_page",
  "update_page_body",
  "list_relations",
  "get_counts",
  "search_all",
  "describe_filters",
].sort();

/** Phase per contract row for everything that is not P1 (the link tools moved to P1 with their service, D19). */
const CONTRACT_PHASES: Record<string, ToolPhase> = {
  list_cycles: "P3",
  get_cycle: "P3",
  create_cycle: "P3",
  update_cycle: "P3",
  reorder_cycle: "P3",
  archive_cycle: "P3",
  unarchive_cycle: "P3",
  delete_cycle: "P3",
  add_work_items_to_cycle: "P3",
  remove_work_items_from_cycle: "P3",
  transfer_cycle_work_items: "P3",
  get_cycle_progress: "P3",
  list_active_cycles: "P3",
  list_modules: "P3",
  get_module: "P3",
  create_module: "P3",
  update_module: "P3",
  reorder_module: "P3",
  archive_module: "P3",
  unarchive_module: "P3",
  delete_module: "P3",
  add_work_items_to_module: "P3",
  remove_work_items_from_module: "P3",
  set_module_members: "P3",
  add_module_link: "P3",
  update_module_link: "P3",
  remove_module_link: "P3",
  get_module_progress: "P3",
  list_views: "P4",
  get_view: "P4",
  create_view: "P4",
  update_view: "P4",
  duplicate_view: "P4",
  lock_view: "P4",
  unlock_view: "P4",
  reorder_view: "P4",
  delete_view: "P4",
  get_view_settings: "P4",
  save_view_settings: "P4",
  reset_view_settings: "P4",
  list_pages: "P6",
  get_page: "P6",
  list_page_backlinks: "P6",
  list_page_versions: "P6",
  create_page: "P6",
  update_page: "P6",
  update_page_body: "P6",
  move_page: "P6",
  duplicate_page: "P6",
  lock_page: "P6",
  unlock_page: "P6",
  archive_page: "P6",
  unarchive_page: "P6",
  restore_page_version: "P6",
  delete_page: "P6",
  list_relations: "P7",
  add_relation: "P7",
  remove_relation: "P7",
};

describe("tool flags", () => {
  it("every delete_* tool and every contract-listed tool is destructive, nothing else", () => {
    for (const def of TOOLS) {
      const expected = def.name.startsWith("delete_") || CONTRACT_DESTRUCTIVE.has(def.name);
      expect(def.destructive === true, def.name).toBe(expected);
    }
  });

  it("destructive tools mutate", () => {
    for (const def of TOOLS) if (def.destructive) expect(def.mutates, def.name).toBe(true);
  });

  it("read tools are the list_*, get_*, search_* and describe_* tools", () => {
    for (const def of TOOLS) {
      const read = /^(list|get|search|describe)_/.test(def.name);
      expect(def.mutates, def.name).toBe(!read);
    }
  });

  it("the core toolset is exactly the contract's starred tools", () => {
    const core = listTools({ toolset: "core" })
      .map((def) => def.name)
      .sort();
    expect(core).toEqual(CONTRACT_CORE);
  });

  it("phases follow the contract rows", () => {
    for (const def of TOOLS) {
      expect(def.phase, def.name).toBe(CONTRACT_PHASES[def.name] ?? "P1");
      expect(TOOL_PHASES).toContain(def.phase);
    }
  });

  it("every P1 tool of the contract rows exists", () => {
    const expected = [
      "list_projects",
      "get_project",
      "create_project",
      "update_project",
      "update_project_features",
      "archive_project",
      "unarchive_project",
      "delete_project",
      "list_archived_projects",
      "list_states",
      "create_state",
      "update_state",
      "reorder_state",
      "set_default_state",
      "delete_state",
      "list_labels",
      "create_label",
      "update_label",
      "reorder_label",
      "delete_label",
      "list_actors",
      "register_actor",
      "list_work_items",
      "get_work_item",
      "get_work_item_by_key",
      "create_work_item",
      "update_work_item",
      "update_work_item_description",
      "move_work_item",
      "bulk_update_work_items",
      "copy_work_item",
      "move_work_item_to_project",
      "set_labels",
      "set_modules",
      "set_assignees",
      "subscribe_work_item",
      "unsubscribe_work_item",
      "archive_work_item",
      "unarchive_work_item",
      "list_archived_work_items",
      "delete_work_item",
      "list_children",
      "list_activity",
      "get_counts",
      "search_all",
      "list_changes",
      "describe_filters",
    ];
    for (const name of expected) expect(registry.has(name), name).toBe(true);
  });

  it("the link tools ship in P1 with their service (D19)", () => {
    for (const name of ["add_link", "update_link", "remove_link"]) expect(getTool(name).phase, name).toBe("P1");
  });

  it("serves project settings and automations through get_project / update_project, not separate tools (D15)", () => {
    for (const name of ["get_project_settings", "update_project_settings", "get_automations", "update_automations"]) {
      expect(registry.has(name), name).toBe(false);
    }
    const fields = Object.keys(getTool("update_project").input.shape);
    expect(fields).toEqual(expect.arrayContaining(["default_assignee_id", "archive_in_months", "close_in_months", "close_state_id"]));
    expect(JSON.stringify(describeFilters())).not.toMatch(/project_settings|automations/);
  });
});

// ---------------------------------------------------------------------------
// listTools / getTool
// ---------------------------------------------------------------------------

describe("listTools", () => {
  it("returns everything by default, in registry order", () => {
    expect(listTools().map((def) => def.name)).toEqual(TOOLS.map((def) => def.name));
  });

  it("filters by phase cumulatively", () => {
    const p1 = listTools({ phase: "P1" }).map((def) => def.name);
    expect(p1).toContain("describe_filters");
    expect(p1).toContain("add_link");
    expect(p1).not.toContain("list_cycles");
    const p3 = listTools({ phase: "P3" }).map((def) => def.name);
    expect(p3).toContain("list_cycles");
    expect(p3).toContain("create_project");
    expect(p3).not.toContain("list_views");
    expect(listTools({ phase: "P7" }).length).toBe(TOOLS.length);
  });

  it("combines toolset and phase", () => {
    const coreP1 = listTools({ toolset: "core", phase: "P1" }).map((def) => def.name);
    expect(coreP1).toContain("list_work_items");
    expect(coreP1).not.toContain("list_cycles");
    expect(coreP1).not.toContain("update_project");
  });
});

describe("getTool", () => {
  it("returns the definition", () => {
    expect(getTool("create_work_item").name).toBe("create_work_item");
  });

  it("throws NOT_FOUND for unknown names", async () => {
    expect(await errorCode(() => getTool("no_such_tool"))).toBe("NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// 5. describe_filters
// ---------------------------------------------------------------------------

describe("describe_filters", () => {
  const payload = describeFilters();

  it("covers every Filters key", () => {
    expect(Object.keys(payload.filters).sort()).toEqual(Object.keys(FiltersSchema.shape).sort());
  });

  it("covers every Display key", () => {
    expect(Object.keys(payload.display).sort()).toEqual(Object.keys(DisplaySchema.shape).sort());
  });

  it("types id filters with their entity and dates, enums, text and booleans by schema", () => {
    expect(payload.filters.state).toEqual({ type: "ids", of: "state", description: expect.any(String) });
    expect(payload.filters.labels.of).toBe("label");
    expect(payload.filters.assignees.of).toBe("actor");
    expect(payload.filters.project.of).toBe("project");
    expect(payload.filters.parent.type).toBe("ids");
    expect(payload.filters.parent.of).toBeUndefined();
    expect(payload.filters.state_group.type).toBe("enum");
    expect(payload.filters.priority.type).toBe("enum");
    expect(payload.filters.type.type).toBe("enum");
    expect(payload.filters.search.type).toBe("text");
    expect(payload.filters.target_date.type).toBe("date");
    expect(payload.filters.sub_items.type).toBe("boolean");
    for (const info of Object.values(payload.filters)) expect(info.description.length).toBeGreaterThan(0);
  });

  it("lists the enums from the schemas", () => {
    expect(payload.enums.state_group).toEqual(StateGroupSchema.options);
    expect(payload.enums.priority).toEqual(PrioritySchema.options);
    expect(payload.enums.module_status).toEqual(ModuleStatusSchema.options);
    expect(payload.enums.relation_type).toEqual(RelationTypeSchema.options);
    expect(payload.enums.intake_status).toEqual(IntakeStatusSchema.options);
    expect(payload.enums.layout).toEqual(LayoutSchema.options);
    expect(payload.enums.palette_color).toEqual(PaletteColorSchema.options);
  });

  it("lists display values that the schema accepts", () => {
    for (const layout of payload.display.layout) expect(DisplaySchema.shape.layout.safeParse(layout).success).toBe(true);
    for (const value of payload.display.group_by) expect(DisplaySchema.shape.group_by.safeParse(value).success).toBe(true);
    for (const value of payload.display.order_by) expect(DisplaySchema.shape.order_by.safeParse(value).success).toBe(true);
    for (const key of payload.display.properties) expect(key in DEFAULT_DISPLAY.properties).toBe(true);
    expect(payload.default_display).toEqual(DEFAULT_DISPLAY);
  });

  it("ships three examples that parse", () => {
    expect(payload.examples).toHaveLength(3);
    for (const example of payload.examples) {
      expect(example.title.length).toBeGreaterThan(0);
      expect(FiltersSchema.safeParse(example.filters).success).toBe(true);
      expect(viewSettings.DisplayPatchSchema.safeParse(example.display).success).toBe(true);
    }
  });

  it("is what the tool returns", async () => {
    const ctx = createTestContext(createTestDb());
    const result = await runToolWithContext(ctx, "describe_filters", {});
    expect(result.data).toBe(payload);
    expectTypeOf<ToolOutput<"describe_filters">>().toEqualTypeOf<DescribeFiltersPayload>();
  });
});

// ---------------------------------------------------------------------------
// 6. Smoke test through the runner
// ---------------------------------------------------------------------------

describe("runToolWithContext", () => {
  it("creates a project and work items, moves one and counts them", async () => {
    const ctx = createTestContext(createTestDb());

    const project = await runToolWithContext(ctx, "create_project", { name: "Smoke", identifier: "SMK" });
    expect(project.data.identifier).toBe("SMK");
    expect(project.cursor).toBeGreaterThan(0);

    // get_project resolves the id and the identifier, in any case (D20).
    expect((await runToolWithContext(ctx, "get_project", { project_id: project.data.id })).data.id).toBe(project.data.id);
    expect((await runToolWithContext(ctx, "get_project", { project_id: "SMK" })).data.id).toBe(project.data.id);
    expect((await runToolWithContext(ctx, "get_project", { project_id: "smk" })).data.id).toBe(project.data.id);
    expect(await errorCode(() => runToolWithContext(ctx, "get_project", { project_id: "NOPE" }))).toBe("NOT_FOUND");
    expect(await errorCode(() => runToolWithContext(ctx, "get_project", { project_id: "" }))).toBe("VALIDATION");

    const first = await runToolWithContext(ctx, "create_work_item", { project_id: project.data.id, name: "First" });
    const second = await runToolWithContext(ctx, "create_work_item", { project_id: project.data.id, name: "Second" });
    expect(second.cursor).toBeGreaterThan(first.cursor);

    const moved = await runToolWithContext(ctx, "move_work_item", { work_item_id: first.data.id, group_by: "priority", value: "high" });
    expect(moved.data.priority).toBe("high");

    const list = await runToolWithContext(ctx, "list_work_items", { scope: { type: "project", project_id: project.data.id } });
    expect(list.data.total).toBe(2);
    expect(list.data.items.map((item) => item.id).sort()).toEqual([first.data.id, second.data.id].sort());
    expect(list.data.cursor).toBe(list.cursor);

    const counted = await runToolWithContext(ctx, "get_counts", { scope: { type: "project", project_id: project.data.id } });
    expect(counted.data.total).toBe(2);
    expect(counted.data.by_priority.high).toBe(1);
    expect(counted.cursor).toBe(moved.cursor);
  });

  it("rejects unknown input keys with VALIDATION", async () => {
    const ctx = createTestContext(createTestDb());
    expect(await errorCode(() => runToolWithContext(ctx, "list_projects", { bogus: true }))).toBe("VALIDATION");
  });

  it("rejects missing required fields with VALIDATION before running", async () => {
    const ctx = createTestContext(createTestDb());
    expect(await errorCode(() => runToolWithContext(ctx, "create_project", { name: "No identifier" }))).toBe("VALIDATION");
    expect(activity.latestSeq(ctx)).toBe(0);
  });

  it("throws NOT_FOUND for an unknown tool", async () => {
    const ctx = createTestContext(createTestDb());
    expect(await errorCode(() => runToolWithContext(ctx, "no_such_tool", {}))).toBe("NOT_FOUND");
  });

  it("wraps array-returning list tools in ListResult", async () => {
    const ctx = createTestContext(createTestDb());
    const result = await runToolWithContext(ctx, "list_actors", {});
    expect(result.data.total).toBe(result.data.items.length);
    expect(result.data.items.map((row) => row.id)).toContain(actors.USER_ACTOR_ID);
    expect(result.data.cursor).toBe(result.cursor);
  });

  it("does not bump the cursor for read tools", async () => {
    const ctx = createTestContext(createTestDb());
    const before = activity.latestSeq(ctx);
    const result = await runToolWithContext(ctx, "list_projects", {});
    expect(result.cursor).toBe(before);
    expect(activity.latestSeq(ctx)).toBe(before);
  });

  it("delete tools return the deleted id", async () => {
    const ctx = createTestContext(createTestDb());
    const project = await runToolWithContext(ctx, "create_project", { name: "Gone", identifier: "GONE" });
    const result = await runToolWithContext(ctx, "delete_project", { project_id: project.data.id });
    expect(result.data).toEqual({ id: project.data.id, deleted: true });
    expect(await errorCode(() => runToolWithContext(ctx, "get_project", { project_id: project.data.id }))).toBe("NOT_FOUND");
  });

  it("infers input and output types per tool name", () => {
    expectTypeOf<ToolInput<"create_project">>().toEqualTypeOf<z.input<typeof projects.CreateProjectInput>>();
    expectTypeOf<ToolInput<"get_project">>().toEqualTypeOf<{ project_id: string }>();
    expectTypeOf<ToolOutput<"get_counts">>().toEqualTypeOf<counts.Counts>();
    expectTypeOf<ToolName>().toMatchTypeOf<string>();
  });
});

// ---------------------------------------------------------------------------
// 7. Mutations outside a transaction still log activity and move the cursor
// ---------------------------------------------------------------------------

describe("activity and cursor", () => {
  it("a mutating tool run outside a transaction writes activity and bumps the cursor", async () => {
    const handles = createTestDb();
    const ctx = createTestContext(handles);
    const project = await runToolWithContext(ctx, "create_project", { name: "Feed", identifier: "FEED" });
    const before = activity.latestSeq(ctx);
    expect(handles.sqlite.inTransaction).toBe(false);

    const label = await runToolWithContext(ctx, "create_label", { project_id: project.data.id, name: "bug" });

    expect(handles.sqlite.inTransaction).toBe(false);
    expect(label.cursor).toBeGreaterThan(before);
    expect(activity.latestSeq(ctx)).toBe(label.cursor);

    const feed = changes.listChanges(ctx, before);
    expect(feed.cursor).toBe(label.cursor);
    expect(feed.changes.length).toBeGreaterThan(0);
    expect(feed.changes.some((change) => change.entity_id === label.data.id && change.actor_id === actors.USER_ACTOR_ID)).toBe(true);
  });

  it("the cursor returned by a mutation is what list_changes reports next", async () => {
    const ctx = createTestContext(createTestDb());
    const created = await runToolWithContext(ctx, "create_project", { name: "Cursor", identifier: "CUR" });
    const polled = await runToolWithContext(ctx, "list_changes", { since_seq: 0 });
    expect(polled.data.cursor).toBe(created.cursor);
    expect(polled.cursor).toBe(created.cursor);
  });
});

// ---------------------------------------------------------------------------
// Server Action runner (error paths need no database)
// ---------------------------------------------------------------------------

describe("runTool (Server Action runner)", () => {
  it("returns NOT_FOUND for an unknown tool instead of throwing", async () => {
    const result = await runTool("no_such_tool", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("returns VALIDATION for a bad payload without opening the database", async () => {
    const result = await runTool("create_project", { name: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION");
      expect(result.details).toBeDefined();
    }
  });

  it("toolAction rejects unknown names at creation and types known ones", () => {
    expect(() => toolAction("no_such_tool" as ToolName)).toThrow();
    const action = toolAction("create_project");
    expectTypeOf(action).parameter(0).toEqualTypeOf<ToolInput<"create_project">>();
    expectTypeOf(action).returns.resolves.toMatchTypeOf<{ ok: boolean }>();
  });
});
