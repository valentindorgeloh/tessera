/**
 * `npm run mcp:stdio -- [--db <path>] [--migrate] [--init] [--toolset core|all]`
 *
 * Serves the Tessera tools over stdio for coding agents (see .mcp.json).
 * The database comes from --db, TESSERA_DB_PATH (.env.local) or
 * data/tessera.db. Pending migrations are refused unless --migrate is given
 * (exit code 2); --init seeds the demo project into an empty database. Only
 * stderr is written to by hand: stdout belongs to the MCP transport.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { loadEnvConfig } from "@next/env";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createContext, listProjects, seedDemo, USER_ACTOR_ID, type Toolset } from "@/lib/tessera";
import { MEMORY_DB, openDatabase, resolveDbPath, type DbHandles } from "@/lib/tessera/db/client";
import { migrateIfNeeded, pendingMigrations } from "@/lib/tessera/db/migrate";
import { createMcpActorResolver, registerTesseraTools } from "@/lib/tessera/tools/mcp";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXIT_USAGE = 1;
const EXIT_PENDING_MIGRATIONS = 2;

const INSTRUCTIONS = [
  "Tessera is a local work tracker: projects hold work items with states, labels, assignees, cycles and modules.",
  "Start with tessera_list_projects; tools take ids (fields ending in _id), not keys, except tessera_get_work_item_by_key.",
  "Call tessera_describe_filters before building list_work_items filters.",
  "Destructive tools (delete_*, bulk updates, moves between projects) need confirm: true.",
  "Errors come back as isError results whose text starts with the error code (NOT_FOUND, VALIDATION, CONFLICT, RULE, ARCHIVED, LOCKED, BUSY).",
].join(" ");

type Flags = { db: string | undefined; migrate: boolean; init: boolean; toolset: Toolset };

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

function fail(code: number, message: string): never {
  log(message);
  process.exit(code);
}

function parseFlags(argv: string[]): Flags {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        db: { type: "string" },
        migrate: { type: "boolean", default: false },
        init: { type: "boolean", default: false },
        toolset: { type: "string", default: "all" },
      },
      strict: true,
      allowPositionals: false,
    });
    if (values.toolset !== "core" && values.toolset !== "all") {
      return fail(EXIT_USAGE, `--toolset must be core or all, got "${values.toolset}"`);
    }
    return { db: values.db, migrate: values.migrate, init: values.init, toolset: values.toolset };
  } catch (err) {
    return fail(EXIT_USAGE, `${err instanceof Error ? err.message : String(err)}\nUsage: tsx scripts/mcp-stdio.ts [--db <path>] [--migrate] [--init] [--toolset core|all]`);
  }
}

/** Migrations the drizzle migrator would still apply; a missing file has all of them pending. */
function countPendingMigrations(filePath: string): number {
  // An empty in-memory database reports the same count as a missing file, without creating the file.
  const sqlite = fs.existsSync(filePath) ? new Database(filePath) : new Database(MEMORY_DB);
  try {
    return pendingMigrations(sqlite);
  } finally {
    sqlite.close();
  }
}

/** Refuses pending migrations without --migrate; with it, migrates under the lock with a backup first. */
function ensureMigrated(filePath: string, migrate: boolean): void {
  const pending = countPendingMigrations(filePath);
  if (pending === 0) return;
  if (!migrate) {
    fail(
      EXIT_PENDING_MIGRATIONS,
      `Tessera database ${filePath} has ${pending} pending migration(s). Start with --migrate (a backup is taken first) or run \`npm run db:migrate\`.`,
    );
  }
  const result = migrateIfNeeded(filePath);
  log(`Applied ${result.applied} migration(s)${result.backup ? `; backup at ${result.backup}` : ""}`);
}

/** `--init`: the demo project, only when the database holds no project at all. */
function seedWhenEmpty(handles: DbHandles): void {
  const ctx = createContext({ db: handles.db, sqlite: handles.sqlite, actorId: USER_ACTOR_ID });
  const existing = listProjects(ctx, {}).length + listProjects(ctx, { archived: true }).length;
  if (existing > 0) {
    log(`--init skipped: the database already has ${existing} project(s)`);
    return;
  }
  const result = seedDemo(ctx);
  log(`Seeded the demo project ${result.project.identifier}`);
}

function packageVersion(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

async function serve(handles: DbHandles, toolset: Toolset): Promise<void> {
  const server = new McpServer({ name: "tessera", version: packageVersion() }, { instructions: INSTRUCTIONS });
  registerTesseraTools(server, {
    handles,
    toolset,
    actorResolver: createMcpActorResolver(handles),
    fallbackClientName: "stdio",
  });
  // The transport closes itself when the client closes stdin; nothing else keeps the process alive.
  server.server.onclose = () => {
    if (handles.sqlite.open) handles.sqlite.close();
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void server.close().finally(() => process.exit(0));
    });
  }
  await server.connect(new StdioServerTransport());
}

async function main(): Promise<void> {
  // Errors only; a successful load prints nothing, and stdout must stay clean for the protocol.
  loadEnvConfig(REPO_ROOT, false, { info: log, error: (...args: unknown[]) => log(args.map(String).join(" ")) });
  const flags = parseFlags(process.argv.slice(2));
  const dbPath = resolveDbPath(flags.db);
  if (dbPath !== MEMORY_DB) ensureMigrated(dbPath, flags.migrate);
  const handles = openDatabase(dbPath);
  log(`Tessera MCP server (stdio): database ${dbPath}; toolset ${flags.toolset}`);
  if (flags.init) seedWhenEmpty(handles);
  await serve(handles, flags.toolset);
}

main().catch((err: unknown) => {
  fail(EXIT_USAGE, err instanceof Error ? (err.stack ?? err.message) : String(err));
});
