/**
 * Helpers for the scripts/live.sh tests (tests/live-script.test.ts, tests/live-build.test.ts). Each test gets a
 * temporary git repo whose untracked node_modules holds a fake `next`, a temporary TESSERA_LIVE_ROOT, an ephemeral
 * port and an absolute temporary database. The fake `next build` writes a tiny build and records its environment;
 * the fake `next start` answers 200 on every path and records its environment. Never touches port 3000.
 */
import Database from "better-sqlite3";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SCRIPT = path.join(REPO_ROOT, "scripts/live.sh");
export const TIMEOUT_MS = 60_000;

/** git without the user's global or system config (no signing, hooks or templates). */
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "live test",
  GIT_AUTHOR_EMAIL: "live-test@example.invalid",
  GIT_COMMITTER_NAME: "live test",
  GIT_COMMITTER_EMAIL: "live-test@example.invalid",
};

/**
 * Stands in for node_modules/next/dist/bin/next. `build` records its env in <root>/fake-build.json and writes
 * <dist>/server/page.js (the commit's marker.txt), <dist>/cache, <dist>/BUILD_ID and a tsconfig.tsbuildinfo; a
 * committed FAIL_BUILD makes it fail, SLOW_BUILD makes it hang with a child process. `start` records its env in
 * <root>/fake-server.json and serves; a CRASH file in the dist dir makes it exit at once.
 */
const FAKE_NEXT = `const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const dist = process.env.TESSERA_DIST_DIR;
const pick = (names) => Object.fromEntries(names.map((n) => [n, process.env[n] ?? null]));
const record = (file, extra) => fs.writeFileSync(file, JSON.stringify({
  pid: process.pid, argv: process.argv.slice(2), cwd: process.cwd(), nice: os.getPriority(), env: Object.keys(process.env).sort(),
  values: pick(["TESSERA_LIVE_BUILD", "TESSERA_DIST_DIR", "TESSERA_DB_PATH", "TESSERA_AUTOMATIONS", "TESSERA_WEBHOOKS", "NEXT_DEPLOYMENT_ID"]),
  key: Boolean(process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY), ...extra }));
if (process.argv[2] === "build") {
  record(path.join("..", "fake-build.json"), { tsbuildinfoBefore: fs.existsSync("tsconfig.tsbuildinfo") });
  if (fs.existsSync("SLOW_BUILD")) {
    const child = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    fs.writeFileSync(path.join("..", "fake-build.pids"), JSON.stringify([process.pid, child.pid]));
    setTimeout(() => process.exit(0), 60000);
  } else if (fs.existsSync("FAIL_BUILD")) {
    console.error("Type error: fake failure");
    process.exit(1);
  } else {
    fs.mkdirSync(path.join(dist, "server"), { recursive: true });
    fs.mkdirSync(path.join(dist, "cache"), { recursive: true });
    fs.writeFileSync(path.join(dist, "server", "page.js"), fs.readFileSync("marker.txt"));
    fs.writeFileSync(path.join(dist, "cache", "turbopack"), "warm");
    fs.writeFileSync(path.join(dist, "BUILD_ID"), process.env.NEXT_DEPLOYMENT_ID);
    fs.writeFileSync("tsconfig.tsbuildinfo", "incremental");
  }
} else if (fs.existsSync(path.join(dist, "CRASH"))) {
  console.error("fake crash at startup");
  process.exit(1);
} else {
  const port = Number(process.argv[process.argv.indexOf("-p") + 1]);
  record(path.join("..", "..", "fake-server.json"), {});
  require("node:http").createServer((req, res) => res.end("ok " + process.env.NEXT_DEPLOYMENT_ID)).listen(port, "127.0.0.1");
}
`;

export const LOCK_V1 = '{ "name": "t", "lockfileVersion": 3, "packages": { "": { "name": "t" } } }\n';
export const LOCK_V2 = '{ "name": "t", "lockfileVersion": 3, "packages": { "": { "name": "t", "version": "2.0.0" } } }\n';

export type CommitSpec = { migrations: number; files?: Record<string, string | null> };

const tempDirs: string[] = [];
const children: ChildProcess[] = [];
const serverPids: number[] = [];

/** For afterEach: kills recorded servers and children and removes temp dirs. */
export function cleanupLive(): void {
  for (const pid of serverPids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export function tempDir(prefix: string): string {
  // realpath: macOS reports /private/var for the symlinked /var tmp dir, and lsof reports cwds that way.
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  tempDirs.push(dir);
  return dir;
}

export function trackChild(child: ChildProcess): ChildProcess {
  children.push(child);
  return child;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function journal(entries: number): string {
  return JSON.stringify({ entries: Array.from({ length: entries }, (_, idx) => ({ idx, when: idx + 1, tag: `m${idx}` })) });
}

/** Adds one commit: `migrations` journal entries, a marker file, and `files` (null deletes one). Returns its short sha. */
export function addCommit(repo: string, spec: CommitSpec): string {
  const n = Number(git(repo, ["rev-list", "--all", "--count"]) || "0");
  fs.writeFileSync(path.join(repo, "drizzle/meta/_journal.json"), journal(spec.migrations));
  fs.writeFileSync(path.join(repo, "marker.txt"), `commit ${n}\n`);
  for (const [name, content] of Object.entries(spec.files ?? {})) {
    if (content === null) fs.rmSync(path.join(repo, name), { force: true });
    else fs.writeFileSync(path.join(repo, name), content);
  }
  git(repo, ["add", "-A", "."]);
  git(repo, ["commit", "-q", "-m", `commit ${n}`]);
  return git(repo, ["rev-parse", "--short=12", "HEAD"]);
}

/** A git repo with one commit per spec and, untracked like the real checkout's, a node_modules with a fake next. */
export function makeRepo(specs: CommitSpec[]): { repo: string; shas: string[] } {
  const repo = tempDir("tessera-live-repo-");
  git(repo, ["init", "-q"]);
  fs.mkdirSync(path.join(repo, "drizzle/meta"), { recursive: true });
  fs.writeFileSync(path.join(repo, "package.json"), "{}\n");
  fs.writeFileSync(path.join(repo, "package-lock.json"), LOCK_V1);
  fs.writeFileSync(path.join(repo, ".gitignore"), "/node_modules\n/.env.local\n");
  const shas = specs.map((spec) => addCommit(repo, spec));
  fs.mkdirSync(path.join(repo, "node_modules/next/dist/bin"), { recursive: true });
  fs.writeFileSync(path.join(repo, "node_modules/next/package.json"), '{ "type": "commonjs" }\n');
  fs.writeFileSync(path.join(repo, "node_modules/next/dist/bin/next"), FAKE_NEXT);
  fs.writeFileSync(path.join(repo, "node_modules/.package-lock.json"), '{ "name": "t", "lockfileVersion": 3, "packages": {} }\n');
  // the script reads the database's migration count with better-sqlite3 from the release or the repo
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules/better-sqlite3"), path.join(repo, "node_modules/better-sqlite3"));
  return { repo, shas };
}

export type Live = { root: string; rel: string; build: string; deps: string; state: string; db: string; port: number; repo: string };

export async function liveRoot(repo: string): Promise<Live> {
  const base = tempDir("tessera-live-");
  const root = path.join(base, "root");
  return {
    root,
    rel: path.join(root, "rel"),
    build: path.join(root, "build"),
    deps: path.join(root, "deps"),
    state: path.join(root, "state"),
    db: path.join(base, "data/live.db"),
    port: await freePort(),
    repo,
  };
}

/** A release folder as `update` leaves it, without a real build: .next-r, the marker and a node_modules link. */
export function fakeRelease(live: Live, sha: string, migrations: number | null, opts: { crash?: boolean } = {}): string {
  const dir = path.join(live.rel, sha);
  fs.mkdirSync(path.join(dir, ".next-r"), { recursive: true });
  if (migrations !== null) fs.writeFileSync(path.join(dir, ".tessera-migrations"), `${migrations}\n`);
  if (opts.crash) fs.writeFileSync(path.join(dir, ".next-r", "CRASH"), "");
  fs.writeFileSync(path.join(dir, "marker.txt"), `release ${sha}\n`);
  if (!fs.existsSync(path.join(dir, "node_modules"))) fs.symlinkSync(path.join(live.repo, "node_modules"), path.join(dir, "node_modules"));
  return dir;
}

export function setState(live: Live, values: Record<string, string>): void {
  fs.mkdirSync(live.state, { recursive: true });
  for (const [name, value] of Object.entries(values)) fs.writeFileSync(path.join(live.state, name), `${value}\n`);
}

export function readState(live: Live, name: string): string | null {
  const file = path.join(live.state, name);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : null;
}

function scriptEnv(live: Live, env: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
    TESSERA_REPO: live.repo,
    TESSERA_LIVE_ROOT: live.root,
    TESSERA_LIVE_PORT: String(live.port),
    TESSERA_LIVE_DB: live.db,
    ...env,
  };
}

/** Runs the script to the end. `env` values of "" unset a variable. `prefix` runs it under another command (nice). */
export function run(live: Live, args: string[], env: Record<string, string> = {}, prefix: string[] = []): { code: number | null; out: string; ms: number } {
  const full = scriptEnv(live, env);
  for (const [name, value] of Object.entries(env)) if (value === "") delete full[name];
  const t0 = Date.now();
  const cmd = [...prefix, "bash", SCRIPT, ...args];
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: REPO_ROOT, encoding: "utf8", timeout: TIMEOUT_MS, env: full });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, ms: Date.now() - t0 };
}

/** Starts the script in the background (for signal and lock tests); resolves `done` with its exit code and output. */
export function runAsync(live: Live, args: string[]): { child: ChildProcess; done: Promise<{ code: number | null; out: string }> } {
  const child = trackChild(spawn("bash", [SCRIPT, ...args], { cwd: REPO_ROOT, env: scriptEnv(live, {}), stdio: ["ignore", "pipe", "pipe"] }));
  let out = "";
  child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
  const done = new Promise<{ code: number | null; out: string }>((resolve) => child.once("exit", (code) => resolve({ code, out })));
  return { child, done };
}

export async function waitFor(check: () => boolean, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Records the server pid so cleanupLive kills it even when an assertion fails first. */
export function serverPid(live: Live): number {
  const pid = Number(readState(live, "pid"));
  expect(pid).toBeGreaterThan(1);
  serverPids.push(pid);
  return pid;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export type FakeRecord = { pid: number; argv: string[]; cwd: string; nice: number; env: string[]; values: Record<string, string | null>; key: boolean; tsbuildinfoBefore?: boolean };

export function fakeServer(live: Live): FakeRecord {
  return JSON.parse(fs.readFileSync(path.join(live.root, "fake-server.json"), "utf8")) as FakeRecord;
}

export function fakeBuild(live: Live): FakeRecord {
  return JSON.parse(fs.readFileSync(path.join(live.root, "fake-build.json"), "utf8")) as FakeRecord;
}

/** A database file whose __drizzle_migrations table holds `applied` rows, as the migrator leaves it. */
export function makeDb(file: string, applied: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec("CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)");
  const insert = db.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)");
  for (let i = 0; i < applied; i += 1) insert.run(`h${i}`, i + 1);
  db.close();
}
