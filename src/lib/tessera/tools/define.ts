/**
 * ToolDef: one entry of the tool registry (docs/contracts/tools.md). The
 * registry is the single enumeration of operations; the UI (Server Actions),
 * MCP and the assistant all reach the engine through these definitions, so a
 * tool carries everything an adapter needs: a stable snake_case name, a human
 * title, a one-paragraph description that states the rules that matter, a
 * strict zod input with every field described, and the mutates / destructive /
 * core / phase flags from the contract tables.
 */
import type { z } from "zod";
import type { TesseraContext } from "../core/context";

/** Phases in shipping order (docs/PLAN.md); `listTools({ phase })` returns what ships by that phase. */
export const TOOL_PHASES = ["P1", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"] as const;

export type ToolPhase = (typeof TOOL_PHASES)[number];

/** `core` is the assistant's default set (~30 tools); `all` is every tool. */
export type Toolset = "all" | "core";

/** A zod object schema; the registry test asserts it is strict and that every field is described. */
export type ToolInputSchema = z.ZodObject;

export type ToolDef<Name extends string = string, Input extends ToolInputSchema = ToolInputSchema, Output = unknown> = {
  /** Stable public name, snake_case verb_noun such as `create_work_item`. */
  name: Name;
  /** Human label such as "Create work item". */
  title: string;
  /** One paragraph for the model and for MCP listings; mentions the rules that matter. */
  description: string;
  /** Strict object; every field documented with `.describe()`. Ids, never keys, except tools that explicitly take a key. */
  input: Input;
  /** false = read tool: no transaction, no activity, no refresh(). */
  mutates: boolean;
  /** The UI confirms, assistant proposals confirm, MCP requires `confirm: true`. */
  destructive?: boolean;
  /** Part of the assistant's default toolset. */
  core?: boolean;
  /** When the tool ships; tools of later phases may already be implemented. */
  phase: ToolPhase;
  // Declared as a method (not a property) so heterogeneous tools fit one Map<string, ToolDef>.
  run(ctx: TesseraContext, input: z.output<Input>): Output | Promise<Output>;
};

/** Identity helper that keeps the literal name, the input schema and the output type for typed wrappers. */
export function defineTool<Name extends string, Input extends ToolInputSchema, Output>(def: ToolDef<Name, Input, Output>): ToolDef<Name, Input, Output> {
  return def;
}
