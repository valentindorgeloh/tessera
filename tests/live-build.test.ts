/**
 * scripts/live.sh, the build half of `update` (decision 140, docs/process/live.md): the fake `next build` in the
 * temporary repo's node_modules (tests/helpers/live.ts) stands in for the real one, so export, dependencies, build
 * env, release folders, prune, the failed build, signals and the lock run for real in about a second each.
 * Never touches port 3000: every run sets TESSERA_LIVE_PORT.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addCommit,
  cleanupLive,
  fakeBuild,
  fakeServer,
  isAlive,
  liveRoot,
  LOCK_V2,
  makeRepo,
  readState,
  run,
  runAsync,
  serverPid,
  TIMEOUT_MS,
  waitFor,
  type Live,
} from "./helpers/live";

afterEach(cleanupLive);

function journalEntries(file: string): number {
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { entries: unknown[] }).entries.length;
}

function get(port: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/api/changes?since=0`, (res) => {
      let body = "";
      res.on("data", (d: Buffer) => (body += d.toString()));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    }).once("error", reject);
  });
}

function releaseNames(live: Live): string[] {
  return fs.readdirSync(live.rel).sort();
}

describe("scripts/live.sh update builds a release", () => {
  it("builds in build/ with a clean env and makes a self-contained release per commit", { timeout: TIMEOUT_MS }, async () => {
    const { repo, shas } = makeRepo([{ migrations: 14 }]);
    const live = await liveRoot(repo);
    const shell = { TESSERA_X: "1", TESSERA_DB_PATH: "/tmp/agent.db", NODE_OPTIONS: "--max-old-space-size=512" };

    const first = run(live, ["update"], shell);
    expect(first.code).toBe(0);
    expect(first.out).toContain(`serving ${shas[0]}`);
    serverPid(live);
    const build = fakeBuild(live);
    expect(build.cwd).toBe(live.build);
    expect(build.values).toEqual({
      TESSERA_LIVE_BUILD: "1",
      TESSERA_DIST_DIR: ".next-build",
      TESSERA_DB_PATH: path.join(live.root, "build-scratch.db"),
      TESSERA_AUTOMATIONS: "off",
      TESSERA_WEBHOOKS: "off",
      NEXT_DEPLOYMENT_ID: shas[0],
    });
    expect(build.env).not.toContain("TESSERA_X");
    expect(build.env).not.toContain("NODE_OPTIONS");
    expect(build.nice).toBe(10);
    expect(build.key).toBe(true);
    expect(build.tsbuildinfoBefore).toBe(false);

    const rel = path.join(live.rel, shas[0]);
    expect(fs.readFileSync(path.join(rel, ".tessera-migrations"), "utf8").trim()).toBe("14");
    expect(fs.readFileSync(path.join(rel, ".next-r/server/page.js"), "utf8")).toBe("commit 0\n");
    expect(fs.readFileSync(path.join(rel, ".next-r/BUILD_ID"), "utf8")).toBe(shas[0]);
    expect(fs.existsSync(path.join(rel, ".next-r/cache"))).toBe(false); // the build cache stays in build/
    expect(fs.statSync(path.join(rel, ".next-r/server/page.js")).mode & 0o077).toBe(0); // the build embeds the actions key
    const firstDeps = fs.readlinkSync(path.join(rel, "node_modules"));
    expect(firstDeps).toMatch(/^\.\.\/\.\.\/deps\/[0-9]+-[0-9]+\/node_modules$/);
    expect(fs.lstatSync(path.join(live.build, "node_modules")).isDirectory()).toBe(true); // Turbopack follows no link out of its root
    expect(fakeServer(live).cwd).toBe(rel);

    fs.mkdirSync(path.join(live.deps, ".p-stale")); // an interrupted clone
    // a second commit with new dependencies and a new migration
    const second = addCommit(repo, { migrations: 15, files: { "package-lock.json": LOCK_V2 } });
    const next = run(live, ["update"]);
    expect(next.code).toBe(0);
    expect(next.out).toContain("dependencies changed");
    serverPid(live);
    expect(fakeBuild(live).tsbuildinfoBefore).toBe(true); // the export keeps the type check's incremental state
    expect(fs.readFileSync(path.join(live.build, ".next-build/cache/turbopack"), "utf8")).toBe("warm");
    const secondRel = path.join(live.rel, second);
    expect(fs.readFileSync(path.join(secondRel, ".tessera-migrations"), "utf8").trim()).toBe("15");
    expect(fs.readlinkSync(path.join(secondRel, "node_modules"))).not.toBe(firstDeps);
    expect(fs.readlinkSync(path.join(rel, "node_modules"))).toBe(firstDeps); // the previous release keeps its own
    expect(fs.readdirSync(live.deps)).toHaveLength(2); // the leftover .p-stale is gone too
    expect(readState(live, "live")).toBe(second);
    expect(readState(live, "previous")).toBe(shas[0]);
    expect(run(live, ["stop"]).code).toBe(0);
  });

  it("prune keeps KEEP releases, never the live or the previous one, and drops unused dependencies and logs", { timeout: TIMEOUT_MS }, async () => {
    const { repo, shas } = makeRepo([{ migrations: 14 }]);
    const live = await liveRoot(repo);
    const env = { TESSERA_LIVE_KEEP: "2" };
    expect(run(live, ["update"], env).code).toBe(0);
    serverPid(live);
    for (let i = 1; i <= 3; i += 1) {
      shas.push(addCommit(repo, { migrations: 14, files: { "package-lock.json": LOCK_V2 } }));
      expect(run(live, ["update"], env).code).toBe(0);
      serverPid(live);
      if (i === 1) {
        // as after an interrupted clone of the build's node_modules; the next commit has the same lock
        fs.rmSync(path.join(live.state, "build-deps"));
        fs.writeFileSync(path.join(live.build, "node_modules/HALF"), "");
      }
    }
    expect(fs.existsSync(path.join(live.build, "node_modules/HALF"))).toBe(false); // cloned again, whole
    // the prune runs before the swap: new (3), live (2) and previous (1) stay, the oldest goes with its logs and deps
    expect(releaseNames(live)).toEqual([shas[1], shas[2], shas[3]].sort());
    expect(fs.readdirSync(live.deps)).toHaveLength(1);
    const logs = fs.readdirSync(path.join(live.root, "logs"));
    expect(logs.some((name) => name.includes(shas[0]))).toBe(false);
    expect(logs).toContain(`build-${shas[3]}.log`);

    expect(run(live, ["rollback"], env).code).toBe(0);
    serverPid(live);
    expect(readState(live, "live")).toBe(shas[2]);
    expect(readState(live, "previous")).toBe(shas[3]);
    expect(run(live, ["stop"]).code).toBe(0);
  });
});

describe("scripts/live.sh update never touches what serves", () => {
  it("a failed build of a commit with a new migration leaves the serving release, its folder and the state alone", { timeout: TIMEOUT_MS }, async () => {
    const { repo, shas } = makeRepo([{ migrations: 14 }]);
    const live = await liveRoot(repo);
    expect(run(live, ["update"]).code).toBe(0);
    const pid = serverPid(live);
    const rel = path.join(live.rel, shas[0]);
    const broken = addCommit(repo, { migrations: 15, files: { FAIL_BUILD: "", "drizzle/0014_probe.sql": "CREATE TABLE probe (id int);\n" } });

    const r = run(live, ["update"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("BUILD FAILED, the running server is untouched");
    expect(r.out).toContain("Type error: fake failure");
    expect(isAlive(pid)).toBe(true);
    expect(await get(live.port)).toEqual({ status: 200, body: `ok ${shas[0]}` });
    expect(journalEntries(path.join(rel, "drizzle/meta/_journal.json"))).toBe(14);
    expect(fs.existsSync(path.join(rel, "drizzle/0014_probe.sql"))).toBe(false);
    expect(journalEntries(path.join(live.build, "drizzle/meta/_journal.json"))).toBe(15); // only the build folder has it
    expect(releaseNames(live)).toEqual([shas[0]]);
    expect(readState(live, "live")).toBe(shas[0]);
    expect(fs.existsSync(path.join(live.root, "logs", `build-${broken}.log`))).toBe(true);
    expect(run(live, ["stop"]).code).toBe(0);
  });

  it("a signal during the build stops the whole build group and frees the lock; stop meanwhile waits its turn", { timeout: TIMEOUT_MS }, async () => {
    const { repo, shas } = makeRepo([{ migrations: 14 }]);
    const live = await liveRoot(repo);
    expect(run(live, ["update"]).code).toBe(0);
    const pid = serverPid(live);
    addCommit(repo, { migrations: 14, files: { SLOW_BUILD: "" } });
    const pidsFile = path.join(live.root, "fake-build.pids");

    const update = runAsync(live, ["update"]);
    await waitFor(() => fs.existsSync(pidsFile));
    const buildPids = JSON.parse(fs.readFileSync(pidsFile, "utf8")) as number[];
    const stop = run(live, ["stop"]); // must not stop the server under a running update
    expect(stop.code).toBe(3);
    expect(stop.out).toContain("another live command is running");
    update.child.kill("SIGTERM");
    const done = await update.done;
    expect(done.code).toBe(143);
    expect(done.out).toContain("stopped by a signal: the build was stopped, the running server is untouched");
    await waitFor(() => buildPids.every((p) => !isAlive(p)), 5_000);
    expect(fs.existsSync(path.join(live.root, "lock"))).toBe(false);
    expect(releaseNames(live)).toEqual([shas[0]]);
    expect(isAlive(pid)).toBe(true);

    fs.rmSync(pidsFile);
    const again = runAsync(live, ["update"]);
    await waitFor(() => fs.existsSync(pidsFile));
    again.child.kill("SIGINT");
    expect((await again.done).code).toBe(130);
    expect(fs.existsSync(path.join(live.root, "lock"))).toBe(false);
    expect(readState(live, "live")).toBe(shas[0]);
    expect(run(live, ["stop"]).code).toBe(0);
  });
});

describe("scripts/live.sh dependencies come from the commit's lock", () => {
  it("refuses when the checkout's package-lock.json is not the commit's", async () => {
    const { repo } = makeRepo([{ migrations: 14 }]);
    const live = await liveRoot(repo);
    fs.writeFileSync(path.join(repo, "package-lock.json"), LOCK_V2); // an uncommitted npm install
    const r = run(live, ["update"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`the commit's package-lock.json differs from ${repo}/package-lock.json`);
    expect(fs.readdirSync(live.deps)).toEqual([]);
    expect(releaseNames(live)).toEqual([]);
  });

  it("refuses when node_modules does not match the lock", async () => {
    const { repo } = makeRepo([{ migrations: 14 }]);
    const live = await liveRoot(repo);
    const installed = { name: "t", lockfileVersion: 3, packages: { "node_modules/left-pad": { version: "9.9.9" } } };
    fs.writeFileSync(path.join(repo, "node_modules/.package-lock.json"), JSON.stringify(installed));
    const r = run(live, ["update"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`${repo}/node_modules does not match package-lock.json (node_modules/left-pad`);
    expect(r.out).toContain("Run npm ci");
    expect(fs.readdirSync(live.deps)).toEqual([]);
  });
});
