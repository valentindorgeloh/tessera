/**
 * Stdio entry (docs/contracts/tools.md "MCP", scripts/mcp-stdio.ts): spawns
 * the real script through StdioClientTransport against a fresh file database,
 * writes through it, then re-opens the file to prove the write landed there.
 * Also covers the migration gate (exit 2 without --migrate), --toolset and --init.
 */
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { eq } from "drizzle-orm";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/tessera/db/client";
import { actor, project } from "@/lib/tessera/db/schema";
import { mcpToolName } from "@/lib/tessera/tools/mcp";
import { listTools } from "@/lib/tessera/tools/registry";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = "scripts/mcp-stdio.ts";
/** tsx compiles the engine on every start; generous so a cold machine passes. */
const STARTUP_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = STARTUP_TIMEOUT_MS + 30_000;

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A path inside a fresh temp directory; the file itself does not exist yet. */
function freshDbPath(): string {
  // realpath: macOS reports /private/var for the symlinked /var tmp dir, and SQLite echoes the real path.
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tessera-mcp-stdio-"));
  tempDirs.push(dir);
  return path.join(dir, "tessera.db");
}

/** The child runs under the node binary of this test process (better-sqlite3 13 needs Node-API 10). */
function childEnv(): Record<string, string> {
  const env = getDefaultEnvironment();
  env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${env.PATH ?? process.env.PATH ?? ""}`;
  delete env.TESSERA_DB_PATH;
  return env;
}

/** Same environment for spawnSync, whose type (Next's ProcessEnv augmentation) insists on NODE_ENV. */
function spawnEnv(): NodeJS.ProcessEnv {
  return childEnv() as NodeJS.ProcessEnv;
}

type Session = { client: Client; stderr: () => string; close(): Promise<void> };

async function startServer(args: string[]): Promise<Session> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", SCRIPT, ...args],
    cwd: REPO_ROOT,
    env: childEnv(),
    stderr: "pipe",
  });
  const chunks: string[] = [];
  transport.stderr?.on("data", (chunk: Buffer | string) => chunks.push(String(chunk)));
  const client = new Client({ name: "vitest-stdio", version: "0.0.1" });
  await client.connect(transport, { timeout: STARTUP_TIMEOUT_MS });
  return { client, stderr: () => chunks.join(""), close: () => client.close() };
}

describe("scripts/mcp-stdio.ts", () => {
  it(
    "serves the tools over stdio and writes into the --db file",
    async () => {
      const dbPath = freshDbPath();
      const session = await startServer(["--db", dbPath, "--migrate"]);
      let created: { id: string; identifier: string };
      try {
        const { tools } = await session.client.listTools();
        expect(tools.map((tool) => tool.name)).toContain(mcpToolName("create_project"));
        const result = await session.client.callTool({
          name: mcpToolName("create_project"),
          arguments: { name: "Stdio project", identifier: "STD" },
        });
        expect(result.isError).toBeFalsy();
        created = result.structuredContent as { id: string; identifier: string };
        expect(created.identifier).toBe("STD");
      } finally {
        await session.close();
      }
      expect(session.stderr()).toContain(dbPath);

      const handles = openDatabase(dbPath);
      try {
        const row = handles.db.select().from(project).where(eq(project.identifier, "STD")).get();
        expect(row?.id).toBe(created.id);
        expect(row?.name).toBe("Stdio project");
        const agent = handles.db.select().from(actor).where(eq(actor.name, "mcp:vitest-stdio")).get();
        expect(agent?.kind).toBe("agent");
        expect(row?.created_by).toBe(agent?.id);
        const databases = handles.sqlite.pragma("database_list") as { name: string; file: string }[];
        expect(databases.find((entry) => entry.name === "main")?.file).toBe(dbPath);
      } finally {
        handles.sqlite.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a fresh file without --migrate and exits with code 2",
    () => {
      const dbPath = freshDbPath();
      const run = spawnSync("npx", ["tsx", SCRIPT, "--db", dbPath], {
        cwd: REPO_ROOT,
        env: spawnEnv(),
        encoding: "utf8",
        timeout: STARTUP_TIMEOUT_MS,
      });
      expect(run.status).toBe(2);
      expect(run.stderr).toContain("--migrate");
      expect(run.stderr).toContain(dbPath);
      expect(run.stdout).toBe("");
      expect(fs.existsSync(dbPath)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "--toolset core limits the listing and --init seeds the demo project",
    async () => {
      const dbPath = freshDbPath();
      const session = await startServer(["--db", dbPath, "--migrate", "--init", "--toolset", "core"]);
      try {
        const { tools } = await session.client.listTools();
        const core = listTools({ toolset: "core" }).map((def) => mcpToolName(def.name));
        expect(tools.map((tool) => tool.name).sort()).toEqual(core.sort());
        const result = await session.client.callTool({ name: mcpToolName("list_projects"), arguments: {} });
        expect(result.isError).toBeFalsy();
        const { items } = result.structuredContent as { items: { identifier: string }[] };
        expect(items.map((item) => item.identifier)).toEqual(["WEB"]);
      } finally {
        await session.close();
      }
      expect(session.stderr()).toContain("Seeded");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects an unknown --toolset with exit code 1",
    () => {
      const dbPath = freshDbPath();
      const run = spawnSync("npx", ["tsx", SCRIPT, "--db", dbPath, "--migrate", "--toolset", "some"], {
        cwd: REPO_ROOT,
        env: spawnEnv(),
        encoding: "utf8",
        timeout: STARTUP_TIMEOUT_MS,
      });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("--toolset");
    },
    TEST_TIMEOUT_MS,
  );
});
