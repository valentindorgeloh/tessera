/**
 * The tool registry (docs/contracts/tools.md): one ToolDef per public
 * operation of the engine. Server Actions, MCP and the assistant all go
 * through `runToolWithContext`, so this file is the single place that maps a
 * tool name to a service function, its strict input schema and its flags.
 *
 * Conventions: inputs take ids (fields ending in `_id`), never keys, except
 * `get_work_item_by_key`; list tools return `ListResult`; delete tools return
 * `{ id, deleted: true }`; every mutating tool runs its service function,
 * which owns the transaction, the activity rows and the FTS updates.
 */
import { z } from "zod";
import { latestSeq } from "../../activity";
import type { TesseraContext } from "../../core/context";
import { notFound, validateInput } from "../../core/errors";
import { TOOL_PHASES, type ToolDef, type ToolPhase, type Toolset } from "../define";
import { projectTools } from "./projects";
import { stateTools } from "./states";
import { labelTools } from "./labels";
import { actorTools } from "./actors";
import { workItemTools } from "./work-items";
import { linkTools } from "./links";
import { cycleTools } from "./cycles";
import { moduleTools } from "./modules";
import { viewTools } from "./views";
import { pageTools } from "./pages";
import { relationTools } from "./relations";
import { commentTools } from "./comments";
import { metaTools } from "./meta";
export type { DeleteResult, RemoveResult } from "./shared";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const TOOLS = [...projectTools, ...stateTools, ...labelTools, ...actorTools, ...workItemTools, ...linkTools, ...cycleTools, ...moduleTools, ...viewTools, ...pageTools, ...relationTools, ...commentTools, ...metaTools];

export type Tool = (typeof TOOLS)[number];
export type ToolName = Tool["name"];
export type ToolByName<N extends ToolName> = Extract<Tool, { name: N }>;
/** What a caller passes (zod input type, defaults optional). */
export type ToolInput<N extends ToolName> = z.input<ToolByName<N>["input"]>;
/** What the tool's `run` resolves to. */
export type ToolOutput<N extends ToolName> = Awaited<ReturnType<ToolByName<N>["run"]>>;

export type ToolResult<T = unknown> = { data: T; cursor: number };

export type ListToolsOptions = { toolset?: Toolset; phase?: ToolPhase };

function buildRegistry(): ReadonlyMap<string, ToolDef> {
  const map = new Map<string, ToolDef>();
  for (const def of TOOLS) {
    if (map.has(def.name)) throw new Error(`duplicate tool name ${def.name}`);
    map.set(def.name, def);
  }
  return map;
}

/** Every tool by name, in contract order. */
export const registry: ReadonlyMap<string, ToolDef> = buildRegistry();

/** NOT_FOUND for unknown names, so adapters report a bad tool name the same way as a bad id. */
export function getTool(name: string): ToolDef {
  const def = registry.get(name);
  if (!def) throw notFound("tool", name);
  return def;
}

/** `toolset: "core"` keeps the assistant's default set; `phase` keeps the tools shipping in or before that phase. */
export function listTools(options: ListToolsOptions = {}): ToolDef[] {
  const maxPhase = options.phase === undefined ? TOOL_PHASES.length - 1 : TOOL_PHASES.indexOf(options.phase);
  return [...registry.values()].filter((def) => {
    if (options.toolset === "core" && def.core !== true) return false;
    return TOOL_PHASES.indexOf(def.phase) <= maxPhase;
  });
}

/** Validates the input against the tool's schema, runs it and returns the data with the change cursor after the call. */
export function runToolWithContext<N extends ToolName>(ctx: TesseraContext, name: N, input: ToolInput<N>): Promise<ToolResult<ToolOutput<N>>>;
export function runToolWithContext(ctx: TesseraContext, name: string, input: unknown): Promise<ToolResult>;
export async function runToolWithContext(ctx: TesseraContext, name: string, input: unknown): Promise<ToolResult> {
  const def = getTool(name);
  const data = validateInput(def.input, input);
  const result = await def.run(ctx, data);
  return { data: result, cursor: latestSeq(ctx) };
}
