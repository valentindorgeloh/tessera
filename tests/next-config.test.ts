/**
 * Live and dev wiring (decision 140, docs/process/live.md): next.config.ts takes distDir from TESSERA_DIST_DIR and
 * uses tsconfig.build.json for every build in its own folder (live or probe), so Next never rewrites the tracked
 * tsconfig.json; tsconfig.build.json narrows the type check to src; `npm run dev` defaults to port 3001 and
 * data/dev/tessera.db (its own folder, so its backups never mix with data/tessera.db's), keeps PORT and
 * TESSERA_DB_PATH overrides, and its database is created and migrated on first use by getDb().
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb, resolveDbPath } from "@/lib/tessera/db/client";
import { backupDir, pendingMigrations } from "@/lib/tessera/db/migrate";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_NAMES = ["TESSERA_DIST_DIR", "TESSERA_LIVE_BUILD", "TESSERA_DB_PATH"] as const;
const saved = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
const tempDirs: string[] = [];

afterEach(() => {
  closeDb();
  for (const name of ENV_NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Evaluates next.config.ts afresh under `env` (undefined unsets a variable). */
async function loadConfig(env: Partial<Record<(typeof ENV_NAMES)[number], string>>): Promise<NextConfig> {
  for (const name of ENV_NAMES) {
    if (env[name] === undefined) delete process.env[name];
    else process.env[name] = env[name];
  }
  vi.resetModules();
  return ((await import("../next.config")) as { default: NextConfig }).default;
}

function parsedTsconfig(file: string): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(file, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    },
  });
  if (!parsed) throw new Error(`cannot parse ${file}`);
  return parsed;
}

function relativeFiles(parsed: ts.ParsedCommandLine, root = REPO_ROOT): string[] {
  return parsed.fileNames.map((f) => path.relative(root, f).split(path.sep).join("/"));
}

/** A folder with copies of both tsconfig files, one source file and a probe build's types. */
function tsconfigCopy(): string {
  const dir = tempDir("tessera-tsconfig-");
  for (const name of ["tsconfig.json", "tsconfig.build.json"]) fs.copyFileSync(path.join(REPO_ROOT, name), path.join(dir, name));
  for (const file of ["src/app/page.tsx", ".next-probe/types/routes.d.ts", "tests/a.test.ts"]) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), "export {};\n");
  }
  return dir;
}

describe("next.config.ts", () => {
  it("defaults to .next and tsconfig.json", async () => {
    const config = await loadConfig({});
    expect(config.distDir).toBe(".next");
    expect(config.typescript?.tsconfigPath).toBe("tsconfig.json");
    expect(config.cacheComponents).toBe(true);
    expect(config.partialPrefetching).toBe(true);
  });

  it("takes distDir from TESSERA_DIST_DIR", async () => {
    expect((await loadConfig({ TESSERA_DIST_DIR: ".next-probe" })).distDir).toBe(".next-probe");
    expect((await loadConfig({ TESSERA_DIST_DIR: "" })).distDir).toBe(".next");
  });

  it("type-checks with tsconfig.build.json for every build in its own folder, live or probe", async () => {
    expect((await loadConfig({ TESSERA_LIVE_BUILD: "1" })).typescript?.tsconfigPath).toBe("tsconfig.build.json");
    expect((await loadConfig({ TESSERA_DIST_DIR: ".next-probe" })).typescript?.tsconfigPath).toBe("tsconfig.build.json");
    expect((await loadConfig({ TESSERA_LIVE_BUILD: "0" })).typescript?.tsconfigPath).toBe("tsconfig.json");
    expect((await loadConfig({ TESSERA_DIST_DIR: "" })).typescript?.tsconfigPath).toBe("tsconfig.json");
  });
});

describe("tsconfig.build.json", () => {
  it("extends tsconfig.json and adds no compiler options of its own", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tsconfig.build.json"), "utf8")) as Record<string, unknown>;
    expect(raw.extends).toBe("./tsconfig.json");
    expect(raw.compilerOptions).toBeUndefined();
    expect(raw.include).toEqual(["next-env.d.ts", "src/**/*", ".next-*/types/**/*.ts", ".next-*/dev/types/**/*.ts"]);
  });

  it("checks the app sources and a build folder's types, but none of the tests that tsconfig.json covers", () => {
    const build = relativeFiles(parsedTsconfig(path.join(REPO_ROOT, "tsconfig.build.json")));
    const full = relativeFiles(parsedTsconfig(path.join(REPO_ROOT, "tsconfig.json")));
    expect(build).toContain("src/app/layout.tsx");
    expect(build.every((f) => f.startsWith("src/") || f === "next-env.d.ts" || f.startsWith(".next-"))).toBe(true);
    expect(full).toContain("tests/next-config.test.ts");
    expect(build).not.toContain("tests/next-config.test.ts");
    expect(parsedTsconfig(path.join(REPO_ROOT, "tsconfig.build.json")).options.strict).toBe(true);

    const copy = tsconfigCopy();
    expect(relativeFiles(parsedTsconfig(path.join(copy, "tsconfig.build.json")), copy).sort()).toEqual([".next-probe/types/routes.d.ts", "src/app/page.tsx"]);
  });

  it("is never rewritten by Next for a probe folder, while tsconfig.json would be", async () => {
    const require = createRequire(import.meta.url);
    const { writeConfigurationDefaults } = require("next/dist/lib/typescript/writeConfigurationDefaults") as {
      writeConfigurationDefaults: (v: string, file: string, first: boolean, app: boolean, dist: string, pages: boolean, strict: boolean) => Promise<void>;
    };
    const copy = tsconfigCopy();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      for (const name of ["tsconfig.build.json", "tsconfig.json"]) {
        const file = path.join(copy, name);
        const before = fs.readFileSync(file, "utf8");
        await writeConfigurationDefaults(ts.version, file, false, true, ".next-probe", false, false);
        const after = fs.readFileSync(file, "utf8");
        if (name === "tsconfig.build.json") expect(after).toBe(before);
        else expect(after).toContain(".next-probe/types/**/*.ts"); // why probe builds must not use tsconfig.json
      }
    } finally {
      log.mockRestore();
    }
  });
});

describe("npm run dev", () => {
  const devScript = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts.dev;
  const launch = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".claude/launch.json"), "utf8")) as {
    configurations: { runtimeExecutable: string; runtimeArgs: string[]; port: number }[];
  };

  /** Runs the script the way npm does (sh -c) with a stand-in `next` that prints its database and arguments. */
  function runDev(env: Record<string, string>): string {
    const bin = tempDir("tessera-dev-bin-");
    fs.writeFileSync(path.join(bin, "next"), '#!/bin/sh\necho "$TESSERA_DB_PATH|$*"\n', { mode: 0o755 });
    const clean = { ...process.env };
    delete clean.PORT;
    delete clean.TESSERA_DB_PATH;
    const r = spawnSync("sh", ["-c", devScript], { encoding: "utf8", env: { ...clean, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, ...env } });
    expect(r.status).toBe(0);
    return r.stdout.trim();
  }

  it("serves 127.0.0.1:3001 on data/dev/tessera.db by default", () => {
    expect(runDev({})).toBe("data/dev/tessera.db|dev -H 127.0.0.1 -p 3001");
  });

  it("keeps an agent's own PORT and TESSERA_DB_PATH", () => {
    expect(runDev({ PORT: "3857", TESSERA_DB_PATH: "/tmp/agent.db" })).toBe("/tmp/agent.db|dev -H 127.0.0.1 -p 3857");
  });

  it("keeps the dev database in its own folder, and getDb() creates and migrates it on first use", () => {
    const dev = resolveDbPath("data/dev/tessera.db");
    expect(dev).toBe(path.join(REPO_ROOT, "data/dev/tessera.db"));
    // backups and exports sit next to the database: dev's never land in the user's data/backups
    expect(backupDir(dev)).toBe(path.join(REPO_ROOT, "data/dev/backups"));
    expect(backupDir(dev)).not.toBe(backupDir(resolveDbPath("data/tessera.db")));
    const file = path.join(tempDir("tessera-dev-db-"), "data/dev/tessera.db");
    process.env.TESSERA_DB_PATH = file;
    expect(fs.existsSync(file)).toBe(false);
    const { sqlite } = getDb();
    expect(fs.existsSync(file)).toBe(true);
    expect(pendingMigrations(sqlite)).toBe(0);
    expect(fs.existsSync(path.join(path.dirname(file), "backups"))).toBe(false); // nothing to back up on a new file
  });

  it("is what the preview launcher runs, on port 3001, with Homebrew's node first on PATH", () => {
    expect(launch.configurations).toHaveLength(1);
    const [config] = launch.configurations;
    expect(config.runtimeExecutable).toBe("/bin/sh");
    expect(config.runtimeArgs).toEqual(["-c", "PATH=/opt/homebrew/bin:$PATH exec npm run dev"]);
    expect(config.port).toBe(3001);
  });

  it.skipIf(!fs.existsSync("/opt/homebrew/bin/npm"))("runs `npm run dev` from a launcher whose PATH has no node", () => {
    const project = tempDir("tessera-launch-");
    fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "launch-probe", private: true, scripts: { dev: devScript } }));
    fs.mkdirSync(path.join(project, "node_modules/.bin"), { recursive: true });
    fs.writeFileSync(path.join(project, "node_modules/.bin/next"), '#!/bin/sh\necho "$TESSERA_DB_PATH|$*"\n', { mode: 0o755 });
    const [config] = launch.configurations;
    const r = spawnSync(config.runtimeExecutable, config.runtimeArgs, {
      cwd: project,
      encoding: "utf8",
      // no NODE_ENV either: a launcher's environment is this bare
      env: { HOME: os.homedir(), PATH: "/usr/bin:/bin", npm_config_update_notifier: "false" } as Partial<NodeJS.ProcessEnv> as NodeJS.ProcessEnv,
    });
    expect(r.stderr).not.toContain("No such file or directory");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("data/dev/tessera.db|dev -H 127.0.0.1 -p 3001");
  });

  it("leaves probe and live build folders out of git", () => {
    expect(fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8").split("\n")).toContain("/.next-*/");
  });
});
