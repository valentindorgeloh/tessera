/**
 * MCP adapter (docs/contracts/tools.md "MCP"): registers every registry tool
 * on a McpServer as `tessera_<name>` with the tool's own strict zod input,
 * which the SDK turns into the advertised JSON Schema (the registry test
 * proves every tool input converts, recursive rich filters included).
 *
 * Per call the adapter resolves the connected client to an actor through
 * `actorResolver` (an `agent` row named `mcp:<client name>`), builds a
 * context for it and runs the tool through `runToolWithContext`, so MCP
 * writes carry the same validation, transactions and activity as the UI.
 * Destructive tools take an extra `confirm: true`; a `TrackerError` becomes
 * an `isError` result whose text starts with the error code.
 */
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { mcpActorName, registerActor, SYSTEM_ACTOR_ID, touchActor } from "../actors";
import { createContext, type TesseraContext } from "../core/context";
import { isTrackerError } from "../core/errors";
import type { DbHandles } from "../db/client";
import type { ActorRow } from "../types";
import type { ToolDef, Toolset } from "./define";
import { listTools, runToolWithContext } from "./registry";

export const MCP_TOOL_PREFIX = "tessera_";

/** What the MCP initialize handshake told us about the client. */
export type McpClientInfo = { name: string; version?: string };

export type McpActorResolver = (clientInfo: McpClientInfo) => ActorRow;

export type RegisterTesseraToolsOptions = {
  /** Open database the tools run against. */
  handles: DbHandles;
  /** `core` exposes the assistant's default set; `all` (default) every tool. */
  toolset?: Toolset;
  /** Maps the connected client to the actor every call runs as; see `createMcpActorResolver`. */
  actorResolver: McpActorResolver;
  /** Called with the registry name (without prefix) after every successful mutating tool. */
  afterWrite?: (toolName: string) => void;
  /** Client name used when the handshake carried none; the actor becomes `mcp:<fallback>`. Defaults to "unknown". */
  fallbackClientName?: string;
};

export function mcpToolName(name: string): string {
  return `${MCP_TOOL_PREFIX}${name}`;
}

/** `confirm` is only part of the MCP-facing schema; the registry input stays as the contract defines it. */
export const CONFIRM_FIELD = "confirm";

const CONFIRM_DESCRIPTION = "Required for this destructive tool: pass true to confirm the operation.";

const ConfirmField = z.boolean().optional().describe(CONFIRM_DESCRIPTION);

/** The schema MCP advertises and validates with: the tool's own strict input, plus `confirm` for destructive tools. */
export function mcpInputSchema(def: ToolDef): z.ZodObject {
  return def.destructive ? def.input.extend({ [CONFIRM_FIELD]: ConfirmField }) : def.input;
}

/** The registry description, plus the confirm rule for destructive tools so a model sees it in tools/list. */
export function mcpToolDescription(def: ToolDef): string {
  if (!def.destructive) return def.description;
  return `${def.description} Destructive: requires confirm: true.`;
}

function clientLabel(info: McpClientInfo): string {
  return info.version ? `${info.name} ${info.version}` : info.name;
}

/**
 * Resolver that registers `mcp:<client name>` as an agent on first contact
 * (as the system actor) and only touches `last_seen_at` afterwards. One
 * resolver per process keeps the cache; a deleted row is re-registered.
 */
export function createMcpActorResolver(handles: DbHandles): McpActorResolver {
  const known = new Map<string, ActorRow>();
  const systemContext = (): TesseraContext => createContext({ db: handles.db, sqlite: handles.sqlite, actorId: SYSTEM_ACTOR_ID });
  return (clientInfo) => {
    const name = mcpActorName(clientInfo.name);
    const ctx = systemContext();
    const cached = known.get(name);
    if (cached) {
      try {
        touchActor(ctx, cached.id);
        return cached;
      } catch (err) {
        if (!isTrackerError(err) || err.code !== "NOT_FOUND") throw err;
        known.delete(name);
      }
    }
    const row = registerActor(ctx, { kind: "agent", name, client_name: clientLabel(clientInfo) });
    known.set(name, row);
    return row;
  };
}

function textResult(text: string, structuredContent?: unknown): CallToolResult {
  return structuredContent === undefined ? { content: [{ type: "text", text }] } : { content: [{ type: "text", text }], structuredContent };
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPendingIntake(data: unknown): boolean {
  if (!isPlainObject(data)) return false;
  const intake = data.intake;
  return isPlainObject(intake) && intake.status === "pending";
}

/** Text for the model: JSON of the result, prefixed with the Intake note when a create was diverted there. */
function successText(def: ToolDef, data: unknown): string {
  const json = JSON.stringify(data ?? null);
  if (def.name !== "create_work_item" || !hasPendingIntake(data)) return json;
  const key = isPlainObject(data) && typeof data.key === "string" ? data.key : "The work item";
  return `${key} was created in Intake: this project requires agent intake, so the item is pending triage and hidden from the board until a person accepts it.\n${json}`;
}

/** structuredContent must be an object; non-object results are wrapped the way the SDK wraps them. */
function structuredResult(data: unknown): unknown {
  return isPlainObject(data) ? data : { result: data ?? null };
}

function resolveClientInfo(server: McpServer, fallback: string): McpClientInfo {
  // Deprecated accessor, but the SDK backfills it per request on the 2026 era and keeps the initialize value on 2025 connections.
  const info = server.server.getClientVersion();
  if (!info || info.name.trim() === "") return { name: fallback };
  return { name: info.name, version: info.version };
}

async function callTool(server: McpServer, options: RegisterTesseraToolsOptions, def: ToolDef, rawArgs: Record<string, unknown>): Promise<CallToolResult> {
  const { [CONFIRM_FIELD]: confirm, ...input } = rawArgs;
  if (def.destructive && confirm !== true) {
    return errorResult(`VALIDATION: ${mcpToolName(def.name)} is destructive. Call it again with ${CONFIRM_FIELD}: true to run it.`);
  }
  const actor = options.actorResolver(resolveClientInfo(server, options.fallbackClientName ?? "unknown"));
  const ctx = createContext({ db: options.handles.db, sqlite: options.handles.sqlite, actorId: actor.id });
  try {
    const { data } = await runToolWithContext(ctx, def.name, def.destructive ? input : rawArgs);
    if (def.mutates) options.afterWrite?.(def.name);
    return textResult(successText(def, data), structuredResult(data));
  } catch (err) {
    if (isTrackerError(err)) return errorResult(`${err.code}: ${err.message}`);
    throw err;
  }
}

/** Registers the selected registry tools on `server` as `tessera_<name>`. */
export function registerTesseraTools(server: McpServer, options: RegisterTesseraToolsOptions): void {
  for (const def of listTools({ toolset: options.toolset ?? "all" })) {
    server.registerTool(
      mcpToolName(def.name),
      {
        title: def.title,
        description: mcpToolDescription(def),
        inputSchema: mcpInputSchema(def),
        annotations: {
          readOnlyHint: !def.mutates,
          destructiveHint: def.destructive === true,
          idempotentHint: !def.mutates,
          openWorldHint: false,
        },
      },
      (args: Record<string, unknown>) => callTool(server, options, def, args),
    );
  }
}
