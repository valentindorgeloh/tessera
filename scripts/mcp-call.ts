/**
 * `npx tsx scripts/mcp-call.ts <tool> ['<json arguments>']`
 *
 * Calls one Tessera tool over stdio, the way an MCP client does, and prints
 * the result (docs/contracts/ui.md "Lane A: engine additions" item 9; used by
 * the P3 acceptance run). `<tool>` is the registry name (list_projects,
 * get_cycle, ...); the MCP name is derived with `mcpToolName`. Arguments are
 * one JSON object and default to `{}`; destructive tools need
 * `"confirm": true`, as for any MCP client.
 *
 * It spawns `npx tsx scripts/mcp-stdio.ts` from the repo root with no `--db`
 * and no `--migrate`, so the server opens exactly the database the dev server
 * resolves (TESSERA_DB_PATH, from the calling shell or .env.local, else
 * data/tessera.db) and refuses pending migrations instead of migrating it.
 * The client is named `p3-acceptance`, so calls run as the agent
 * `mcp:p3-acceptance`.
 *
 * Output: the server's stderr (it names the absolute database path) goes to
 * stderr; `structuredContent`, else the first text content, goes to stdout as
 * JSON. Exit codes: 0 success, 1 when the tool answers with an error result
 * (or the call is refused, or the command line is unusable), 2 when the
 * connection to the server fails.
 */
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mcpToolName } from "@/lib/tessera/tools/mcp";
import { registry } from "@/lib/tessera/tools/registry";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_SCRIPT = "scripts/mcp-stdio.ts";
const CLIENT_NAME = "p3-acceptance";
const USAGE = "Usage: npx tsx scripts/mcp-call.ts <tool> ['<json arguments>']";
/** tsx compiles the engine on every start; generous so a cold machine connects. */
const CONNECT_TIMEOUT_MS = 120_000;
const CALL_TIMEOUT_MS = 120_000;

const EXIT_TOOL_ERROR = 1;
const EXIT_CONNECTION = 2;

type Invocation = { tool: string; args: Record<string, unknown> };

function log(message: string): void {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The tool name and its JSON object of arguments; null (after a message on stderr) when unusable. */
function parseInvocation(argv: string[]): Invocation | null {
  const [tool, rawArgs, ...extra] = argv;
  if (tool === undefined || tool === "" || extra.length > 0) {
    log(USAGE);
    return null;
  }
  if (!registry.has(tool)) {
    log(`Unknown tool "${tool}"; pass a registry name such as list_projects or get_cycle.\n${USAGE}`);
    return null;
  }
  if (rawArgs === undefined) return { tool, args: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs);
  } catch (err) {
    log(`The arguments are not valid JSON: ${messageOf(err)}\n${USAGE}`);
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    log(`The arguments must be one JSON object, e.g. '{"project_id":"…"}'.\n${USAGE}`);
    return null;
  }
  return { tool, args: parsed as Record<string, unknown> };
}

/**
 * The whitelisted default environment, with this Node's directory first on
 * PATH (better-sqlite3 13 needs Node-API 10) and TESSERA_DB_PATH copied over
 * when the calling shell sets it (otherwise the server reads .env.local).
 */
function serverEnv(): Record<string, string> {
  const env = getDefaultEnvironment();
  env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${env.PATH ?? process.env.PATH ?? ""}`;
  const dbPath = process.env.TESSERA_DB_PATH;
  if (dbPath !== undefined && dbPath !== "") env.TESSERA_DB_PATH = dbPath;
  return env;
}

/** structuredContent when present, else the first text content (parsed when it is JSON text), else null. */
function resultValue(result: { structuredContent?: unknown; content?: unknown }): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const blocks = Array.isArray(result.content) ? (result.content as unknown[]) : [];
  for (const block of blocks) {
    if (typeof block !== "object" || block === null) continue;
    const { type, text } = block as { type?: unknown; text?: unknown };
    if (type !== "text" || typeof text !== "string") continue;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return null;
}

async function main(): Promise<number> {
  const invocation = parseInvocation(process.argv.slice(2));
  if (invocation === null) return EXIT_TOOL_ERROR;

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", SERVER_SCRIPT],
    cwd: REPO_ROOT,
    env: serverEnv(),
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer | string) => process.stderr.write(chunk));
  const client = new Client({ name: CLIENT_NAME, version: "1.0.0" });

  try {
    await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
  } catch (err) {
    log(`Could not connect to ${SERVER_SCRIPT}: ${messageOf(err)}`);
    await client.close().catch(() => undefined);
    return EXIT_CONNECTION;
  }

  try {
    const result = await client.callTool({ name: mcpToolName(invocation.tool), arguments: invocation.args }, { timeout: CALL_TIMEOUT_MS });
    process.stdout.write(`${JSON.stringify(resultValue(result), null, 2)}\n`);
    return result.isError === true ? EXIT_TOOL_ERROR : 0;
  } catch (err) {
    log(`The call to ${invocation.tool} failed: ${messageOf(err)}`);
    return EXIT_TOOL_ERROR;
  } finally {
    await client.close().catch(() => undefined);
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    log(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = EXIT_CONNECTION;
  },
);
