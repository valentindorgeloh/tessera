/**
 * Registry tools as Anthropic tools (decision 36). Reads run as themselves.
 * Mutations are `propose_<name>` and write only a proposal; Apply is the
 * person's step. Tool order follows `listTools`, so the cached prefix is stable.
 */
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool, BetaToolRunContext } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { ToolError } from "@anthropic-ai/sdk/lib/tools/ToolError";
import { assistantContext } from "../ai/client";
import { createProposal } from "../ai/proposals";
import { isTrackerError } from "../core/errors";
import type { DbHandles } from "../db/client";
import type { AssistantEvent } from "../types";
import type { ToolDef, Toolset } from "./define";
import { listTools, runToolWithContext } from "./registry";

export const PROPOSE_PREFIX = "propose_";

/** Tool results longer than this are cut and marked `truncated`. */
const RESULT_CHAR_LIMIT = 50_000;
const SUMMARY_CHAR_LIMIT = 200;

export function buildAssistantTools(
  handles: DbHandles,
  opts: {
    toolset: Toolset;
    conversationId: string;
    projectId: string | null;
    emit: (event: AssistantEvent) => void;
  },
): BetaRunnableTool[] {
  return listTools({ toolset: opts.toolset }).map((def) => toAnthropicTool(handles, def, opts));
}

function toAnthropicTool(
  handles: DbHandles,
  def: ToolDef,
  opts: { conversationId: string; projectId: string | null; emit: (event: AssistantEvent) => void },
): BetaRunnableTool {
  const name = def.mutates ? `${PROPOSE_PREFIX}${def.name}` : def.name;
  if (name.length > 64) throw new Error(`tool name exceeds 64 characters: ${name}`);
  const tool = betaZodTool({
    name,
    description: def.mutates ? proposeDescription(def) : def.description,
    inputSchema: def.input,
    run: (args, context) => (def.mutates ? propose(handles, def, args, context, opts) : read(handles, def, args, context, opts.emit)),
  });
  const parse = tool.parse;
  return {
    ...tool,
    parse: (content) => {
      try {
        return parse(content);
      } catch (err) {
        throw new ToolError(`VALIDATION: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

function proposeDescription(def: ToolDef): string {
  const base = `Proposes, does not apply: ${def.description} Nothing changes until the person applies it.`;
  return def.destructive ? `${base} Destructive: the person must confirm.` : base;
}

async function read(
  handles: DbHandles,
  def: ToolDef,
  args: unknown,
  context: BetaToolRunContext | undefined,
  emit: (event: AssistantEvent) => void,
): Promise<string> {
  const ctx = assistantContext(handles);
  const id = context?.toolUse.id ?? "";
  try {
    const { data } = await runToolWithContext(ctx, def.name, args);
    const text = encodeToolResult(data);
    emit({ type: "tool_result", id, ok: true, summary: summarize(text) });
    return text;
  } catch (err) {
    if (!isTrackerError(err)) throw err;
    const message = `${err.code}: ${err.message}`;
    emit({ type: "tool_result", id, ok: false, summary: summarize(message) });
    throw new ToolError(message);
  }
}

function propose(
  handles: DbHandles,
  def: ToolDef,
  args: unknown,
  context: BetaToolRunContext | undefined,
  opts: { conversationId: string; projectId: string | null; emit: (event: AssistantEvent) => void },
): string {
  const ctx = assistantContext(handles);
  try {
    const proposal = createProposal(ctx, {
      conversation_id: opts.conversationId,
      source: "assistant",
      tool: def.name,
      input: args,
      project_id: opts.projectId,
      tool_use_id: context?.toolUse.id ?? null,
    });
    opts.emit({ type: "proposal", proposal });
    return JSON.stringify({
      proposal_id: proposal.id,
      status: "pending",
      preview: proposal.preview.title,
      note: proposal.preview.note ?? null,
    });
  } catch (err) {
    if (isTrackerError(err) && err.code === "VALIDATION") throw new ToolError(`${err.code}: ${err.message}`);
    throw err;
  }
}

function encodeToolResult(data: unknown): string {
  const json = JSON.stringify(data);
  if (json.length <= RESULT_CHAR_LIMIT) return json;
  let text = json.slice(0, RESULT_CHAR_LIMIT);
  let encoded = JSON.stringify({ truncated: true, text });
  while (encoded.length > RESULT_CHAR_LIMIT && text.length > 0) {
    text = text.slice(0, Math.min(text.length - 1, text.length - (encoded.length - RESULT_CHAR_LIMIT)));
    encoded = JSON.stringify({ truncated: true, text });
  }
  return encoded;
}

function summarize(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= SUMMARY_CHAR_LIMIT ? line : `${line.slice(0, SUMMARY_CHAR_LIMIT - 3)}...`;
}
