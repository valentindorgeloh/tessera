/**
 * scripts/live.sh, the live app (decision 140, docs/process/live.md): refusals, pins, the clean server environment
 * and swaps. Spawns the real script with a temporary TESSERA_LIVE_ROOT, an ephemeral port and an absolute temporary
 * database, on fake release folders (tests/helpers/live.ts); the build half is in tests/live-build.test.ts.
 * Never touches port 3000: every run sets TESSERA_LIVE_PORT.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupLive,
  fakeRelease,
  fakeServer,
  isAlive,
  liveRoot,
  makeDb,
  makeRepo,
  readState,
  REPO_ROOT,
  run,
  serverPid,
  setState,
  TIMEOUT_MS,
  trackChild,
} from "./helpers/live";

afterEach(cleanupLive);

describe("scripts/live.sh refusals", () => {
  it("status on an empty root prints live=none and creates nothing; help and a mistyped command neither", async () => {
    const { repo, shas } = makeRepo([{ migrations: 14 }]);
    const live = await liveRoot(repo);
    const r = run(live, ["status"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("live=none");
    expect(r.out).toContain("previous=none");
    expect(r.out).toContain(`head=${shas[0]} live_is_head=no`);
    expect(r.out).toContain("does not serve HEAD");
    expect(run(live, ["help"]).code).toBe(0);
    expect(run(live, ["staus"]).code).toBe(1);
    expect(run(live, ["update", "--froce"]).code).toBe(1);
    expect(fs.existsSync(live.root)).toBe(false);
  });

  it("a relative TESSERA_LIVE_DB exits 2 before creating anything", async () => {
    const { repo } = makeRepo([{ migrations: 14 }]);
    const live = await liveRoot(repo);
    const r = run(live, ["status"], { TESSERA_LIVE_DB: "data/tessera.db" });
    expect(r.code).toBe(2);
    expect(r.out).toContain("must be an absolute path");
    expect(fs.existsSync(live.root)).toBe(false);
  });

  it("a fresh lock exits 3 without exporting, and a stale one is cleared", async () => {
    const { repo } = makeRepo([{ migrations: 14 }]);
    const live = await liveRoot(repo);
    fs.mkdirSync(path.join(live.root, "lock"), { recursive: true });
    const r = run(live, ["update"]);
    expect(r.code).toBe(3);
    expect(r.out).toContain("another live command is running");
    expect(fs.readdirSync(live.rel)).toEqual([]);
    expect(fs.existsSync(path.join(live.root, "lock"))).toBe(true);

    const gone = spawnSync(process.execPath, ["-e", "0"]).pid; // a pid that no longer runs
    fs.writeFileSync(path.join(live.root, "lock/pid"), `${gone}\n`);
    const cleared = run(live, ["stop"]);
    expect(cleared.code).toBe(0);
    expect(cleared.out).toContain(`clearing a stale lock: pid ${gone} runs no live command`);
    expect(fs.existsSync(path.join(live.root, "lock"))).toBe(false);
  });

  it("a foreign listener makes stop exit 4 and the listener survives", async () => {
    const { repo } = makeRepo([{ migrations: 14 }]);
    const live = await liveRoot(repo);
    const foreign = trackChild(
      spawn(process.execPath, ["-e", `require("node:net").createServer().listen(${live.port}, "127.0.0.1", () => console.log("up"))`], {
        cwd: os.tmpdir(),
        stdio: ["ignore", "pipe", "inherit"],
      }),
    );
    await new Promise<void>((resolve) => foreign.stdout?.once("data", () => resolve()));
    const r = run(live, ["stop"]);
    expect(r.code).toBe(4);
    expect(r.out).toContain(`port ${live.port} is held by another process (pid ${foreign.pid}`);
    expect(foreign.exitCode).toBeNull();
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(live.port, "127.0.0.1", () => {
        socket.end();
        resolve();
      });
      socket.once("error", reject);
    });
  });

  it("rollback without a previous release exits 1", async () => {
    const { repo } = makeRepo([{ migrations: 14 }]);
    const live = await liveRoot(repo);
    const r = run(live, ["rollback"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("no previous release");
  });

  it("rollback to a release that knows fewer migrations than the database exits 5 and prints the restore hint", async () => {
    const { repo, shas } = makeRepo([{ migrations: 13 }, { migrations: 14 }]);
    const live = await liveRoot(repo);
    fakeRelease(live, shas[0], 13);
    fakeRelease(live, shas[1], 14);
    setState(live, { live: shas[1], previous: shas[0] });
    makeDb(live.db, 14);
    const backups = path.join(path.dirname(live.db), "backups");
    fs.mkdirSync(backups, { recursive: true });
    for (const name of ["tessera-migration-2026-10-20T08-00-00.000Z.db", "tessera-migration-2026-10-24T08-00-00.000Z.db", "tessera-manual-2026-10-25T08-00-00.000Z.db"]) {
      fs.writeFileSync(path.join(backups, name), "");
    }
    const newest = path.join(backups, "tessera-migration-2026-10-24T08-00-00.000Z.db");
    const r = run(live, ["rollback"]);
    expect(r.code).toBe(5);
    expect(r.out).toContain(`${shas[0]} knows 13 migrations, but ${live.db} has 14 applied`);
    expect(r.out).toContain(`Newest backup taken before a migration: ${newest}`);
    expect(r.out).toContain(`TESSERA_DB_PATH=${live.db} npm run db:restore -- ${newest} --yes`);
    expect(r.out).toContain("npm run live:rollback -- --force");
    expect(readState(live, "live")).toBe(shas[1]);
    expect(readState(live, "pid")).toBeNull();

    // another database in the same folder shares data/backups: no ready restore command then
    fs.writeFileSync(path.join(path.dirname(live.db), "dev.db"), "");
    const shared = run(live, ["rollback"]);
    expect(shared.code).toBe(5);
    expect(shared.out).toContain("also holds other databases (dev.db )");
    expect(shared.out).not.toContain("npm run db:restore");
  });

  it("update to a commit with fewer migrations than the database exits 5 before exporting or building", async () => {
    const { repo, shas } = makeRepo([{ migrations: 13 }, { migrations: 14 }]);
    const live = await liveRoot(repo);
    fakeRelease(live, shas[1], 14);
    setState(live, { live: shas[1] });
    makeDb(live.db, 14);
    const r = run(live, ["update", shas[0]]);
    expect(r.code).toBe(5);
    expect(r.out).toContain(`npm run live:update -- ${shas[0]} --force`);
    expect(fs.readdirSync(live.rel)).toEqual([shas[1]]);
    expect(fs.readdirSync(live.build)).toEqual([]);
  });

  it("a release without a readable migration count is refused unless forced", { timeout: TIMEOUT_MS }, async () => {
    const { repo, shas } = makeRepo([{ migrations: 14 }]);
    const live = await liveRoot(repo);
    fakeRelease(live, shas[0], null);
    setState(live, { live: shas[0] });
    const r = run(live, ["start"]);
    expect(r.code).toBe(5);
    expect(r.out).toContain(`cannot tell whether ${shas[0]} (knows unknown migrations) fits ${live.db} (0 applied)`);
    expect(r.out).toContain("npm run live -- --force");
    const forced = run(live, ["start", "--force"]);
    expect(forced.code).toBe(0);
    serverPid(live);
    expect(run(live, ["stop"]).code).toBe(0);
  });

  it("a niced shell is refused: the live server would keep the nice level", async () => {
    const { repo, shas } = makeRepo([{ migrations: 14 }]);
    const live = await liveRoot(repo);
    fakeRelease(live, shas[0], 14);
    setState(live, { live: shas[0] });
    const r = run(live, ["start"], {}, ["nice", "-n", "5"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("this shell runs at nice 5");
    expect(readState(live, "pid")).toBeNull();
    expect(fs.existsSync(path.join(live.root, "lock"))).toBe(false);
  });
});

describe("scripts/live.sh pins the root to one repo and one database", () => {
  it("another checkout or another TESSERA_LIVE_DB exits 6; --repin moves the pin", { timeout: TIMEOUT_MS }, async () => {
    const main = makeRepo([{ migrations: 14 }]);
    const other = makeRepo([{ migrations: 14 }]);
    const live = await liveRoot(main.repo);
    fakeRelease(live, main.shas[0], 14);
    setState(live, { live: main.shas[0] });
    expect(run(live, ["start"]).code).toBe(0);
    const pid = serverPid(live);
    expect(readState(live, "repo")).toBe(main.repo);
    expect(readState(live, "db")).toBe(live.db);

    const fromOther = run(live, ["update"], { TESSERA_REPO: other.repo });
    expect(fromOther.code).toBe(6);
    expect(fromOther.out).toContain(`serves the repo ${main.repo} with the database ${live.db}, and this run asks for ${other.repo}`);
    expect(fs.readdirSync(live.build)).toEqual([]);
    const otherDb = path.join(path.dirname(live.db), "other.db");
    expect(run(live, ["start"], { TESSERA_LIVE_DB: otherDb }).code).toBe(6);
    expect(run(live, ["stop"], { TESSERA_REPO: other.repo }).code).toBe(6);
    expect(isAlive(pid)).toBe(true);
    expect(readState(live, "live")).toBe(main.shas[0]);

    // without TESSERA_LIVE_DB the pinned database is used, so the user's own shell needs no setting
    expect(run(live, ["start"], { TESSERA_LIVE_DB: "" }).out).toContain(`already serving ${main.shas[0]}`);

    const moved = run(live, ["start", "--repin"], { TESSERA_LIVE_DB: otherDb });
    expect(moved.code).toBe(0);
    expect(moved.out).toContain(`--repin: the root moves from ${main.repo} with ${live.db} to ${main.repo} with ${otherDb}`);
    expect(readState(live, "db")).toBe(otherDb);
    expect(run(live, ["stop"], { TESSERA_LIVE_DB: otherDb }).code).toBe(0);
  });
});

describe("scripts/live.sh swaps (fake releases, no build)", () => {
  it("start detaches the server into its own session with a clean environment, and stop stops only it", { timeout: TIMEOUT_MS }, async () => {
    const { repo, shas } = makeRepo([{ migrations: 14 }]);
    const live = await liveRoot(repo);
    fakeRelease(live, shas[0], 14);
    setState(live, { live: shas[0] });
    fs.writeFileSync(path.join(repo, ".env.local"), "ANTHROPIC_API_KEY=from-env-local\n");

    // an agent's shell: none of this may reach the user's server
    const agentShell = {
      ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
      NODE_OPTIONS: "--max-old-space-size=512",
      NODE_ENV: "test",
      HTTPS_PROXY: "http://127.0.0.1:9",
      PORT: "1",
      CLAUDE_CODE_MESSAGING_TOKEN: "secret",
      TESSERA_AUTOMATIONS: "off",
    };
    const started = run(live, ["start"], agentShell);
    expect(started.code).toBe(0);
    expect(started.out).toContain(`serving ${shas[0]} on http://127.0.0.1:${live.port}`);
    const pid = serverPid(live);
    // its own session (STAT "s", process group = pid), adopted by launchd once the launcher exited
    const ps = spawnSync("ps", ["-o", "ppid=,pgid=,stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim().split(/\s+/);
    expect(ps[0]).toBe("1");
    expect(ps[1]).toBe(String(pid));
    expect(ps[2]).toContain("s");

    const info = fakeServer(live);
    expect(info.pid).toBe(pid);
    expect(info.argv).toEqual(["start", "-H", "127.0.0.1", "-p", String(live.port)]);
    expect(info.cwd).toBe(path.join(live.rel, shas[0]));
    expect(info.values.TESSERA_DIST_DIR).toBe(".next-r");
    expect(info.values.NEXT_DEPLOYMENT_ID).toBe(shas[0]);
    expect(info.values.TESSERA_DB_PATH).toBe(live.db);
    expect(info.values.TESSERA_AUTOMATIONS).toBeNull(); // .env.local sets the live app's settings, not the shell
    for (const name of Object.keys(agentShell)) expect(info.env).not.toContain(name);
    // the allowlist, plus what macOS adds to every process (__CF_USER_TEXT_ENCODING)
    const base = ["HOME", "USER", "LOGNAME", "SHELL", "PATH", "TMPDIR", "LANG", "LC_ALL", "__CF_USER_TEXT_ENCODING"];
    expect(info.env.filter((name) => !base.includes(name)).sort()).toEqual(
      ["NEXT_DEPLOYMENT_ID", "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY", "TESSERA_DB_PATH", "TESSERA_DIST_DIR"],
    );
    expect(info.env).toContain("HOME");
    expect(info.nice).toBe(0);
    expect(info.key).toBe(true);
    expect(fs.statSync(path.join(live.state, "actions.key")).mode & 0o777).toBe(0o600);
    expect(fs.statSync(live.root).mode & 0o777).toBe(0o700); // the builds embed the actions key
    expect(fs.readFileSync(path.join(live.rel, shas[0], ".env.local"), "utf8")).toBe("ANTHROPIC_API_KEY=from-env-local\n");

    const status = run(live, ["status"]);
    expect(status.out).toContain(`live=${shas[0]} previous=none head=${shas[0]} live_is_head=yes listener=${pid} pid=${pid}`);
    expect(status.out).toContain("The live app serves HEAD.");

    const again = run(live, ["start"]);
    expect(again.code).toBe(0);
    expect(again.out).toContain(`already serving ${shas[0]}`);
    expect(Number(readState(live, "pid"))).toBe(pid);

    const stopped = run(live, ["stop"]);
    expect(stopped.code).toBe(0);
    expect(isAlive(pid)).toBe(false);
    expect(readState(live, "pid")).toBeNull();
    expect(run(live, ["status"]).out).toContain("listener= pid=none");
  });

  it("rollback swaps to the previous release, which runs from its own folder", { timeout: TIMEOUT_MS }, async () => {
    const { repo, shas } = makeRepo([{ migrations: 14 }, { migrations: 14 }]);
    const live = await liveRoot(repo);
    fakeRelease(live, shas[0], 14);
    fakeRelease(live, shas[1], 14);
    setState(live, { live: shas[1], previous: shas[0] });

    expect(run(live, ["start"]).code).toBe(0);
    const first = serverPid(live);
    expect(fakeServer(live).cwd).toBe(path.join(live.rel, shas[1]));

    const back = run(live, ["rollback"]);
    expect(back.code).toBe(0);
    expect(back.out).toContain(`serving ${shas[0]}`);
    const second = serverPid(live);
    expect(second).not.toBe(first);
    expect(isAlive(first)).toBe(false);
    // the server reads drizzle/ from its cwd: each release has its own tree, so nothing is re-exported
    expect(fakeServer(live).cwd).toBe(path.join(live.rel, shas[0]));
    expect(readState(live, "live")).toBe(shas[0]);
    expect(readState(live, "previous")).toBe(shas[1]);
    expect(run(live, ["status"]).out).toContain(`live=${shas[0]} previous=${shas[1]} head=${shas[1]} live_is_head=no`);

    expect(run(live, ["stop"]).code).toBe(0);
    expect(isAlive(second)).toBe(false);
  });

  it("a new server that exits at once is noticed early and the old release serves again", { timeout: TIMEOUT_MS }, async () => {
    const { repo, shas } = makeRepo([{ migrations: 14 }, { migrations: 14 }]);
    const live = await liveRoot(repo);
    fakeRelease(live, shas[0], 14);
    fakeRelease(live, shas[1], 14, { crash: true });
    setState(live, { live: shas[0] });
    expect(run(live, ["start"]).code).toBe(0);
    serverPid(live);

    const r = run(live, ["update", shas[1]]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("the new server did not answer 200");
    expect(r.out).toContain("fake crash at startup");
    expect(r.out).toContain(`the live release ${shas[0]} serves again`);
    expect(r.ms).toBeLessThan(20_000); // the health loop stops when the process is gone (600 tries would take 30 s or more)
    serverPid(live);
    expect(fakeServer(live).cwd).toBe(path.join(live.rel, shas[0]));
    expect(readState(live, "live")).toBe(shas[0]);
    expect(run(live, ["stop"]).code).toBe(0);
  });

  it("the old release is not restarted when the database has migrations it does not know", { timeout: TIMEOUT_MS }, async () => {
    const { repo, shas } = makeRepo([{ migrations: 13 }, { migrations: 14 }]);
    const live = await liveRoot(repo);
    fakeRelease(live, shas[0], 13);
    fakeRelease(live, shas[1], 14, { crash: true });
    setState(live, { live: shas[0] });
    makeDb(live.db, 14); // the new release's first request migrated it before the crash
    expect(run(live, ["start", "--force"]).code).toBe(0);
    const old = serverPid(live);

    const r = run(live, ["update", shas[1]]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`not restarting ${shas[0]}: ${live.db} has 14 migrations applied and ${shas[0]} knows 13. Nothing serves on port ${live.port} now.`);
    expect(r.out).toContain("Newest backup taken before a migration");
    expect(isAlive(old)).toBe(false);
    expect(run(live, ["status"]).out).toContain("listener= pid=none");
  });

  it("a launch that fails after the stop falls back instead of exiting with nothing serving", { timeout: TIMEOUT_MS }, async () => {
    const { repo, shas } = makeRepo([{ migrations: 14 }, { migrations: 14 }]);
    const live = await liveRoot(repo);
    fakeRelease(live, shas[0], 14);
    fakeRelease(live, shas[1], 14);
    setState(live, { live: shas[0] });
    expect(run(live, ["start"]).code).toBe(0);
    serverPid(live);
    fs.mkdirSync(path.join(live.root, "logs", `server-${shas[1]}.log`)); // the launcher cannot open its log

    const r = run(live, ["update", shas[1]]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`the live release ${shas[0]} serves again`);
    serverPid(live);
    expect(fakeServer(live).cwd).toBe(path.join(live.rel, shas[0]));
    expect(run(live, ["stop"]).code).toBe(0);
  });

  it("a swap needs free disk before it stops the running server", { timeout: TIMEOUT_MS }, async () => {
    const { repo, shas } = makeRepo([{ migrations: 14 }, { migrations: 14 }]);
    const live = await liveRoot(repo);
    fakeRelease(live, shas[0], 14);
    fakeRelease(live, shas[1], 14);
    setState(live, { live: shas[0] });
    expect(run(live, ["start"]).code).toBe(0);
    const pid = serverPid(live);
    const r = run(live, ["update", shas[1]], { TESSERA_LIVE_MIN_FREE_MB: "100000000" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("refused: too little free disk");
    expect(isAlive(pid)).toBe(true);
    expect(readState(live, "live")).toBe(shas[0]);
    expect(run(live, ["stop"]).code).toBe(0);
  });
});

describe("package.json live scripts", () => {
  it("map live, live:update, live:rollback, live:stop and live:status onto scripts/live.sh", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.live).toBe("bash scripts/live.sh start");
    for (const cmd of ["update", "rollback", "stop", "status"]) expect(pkg.scripts[`live:${cmd}`]).toBe(`bash scripts/live.sh ${cmd}`);
    expect(pkg.scripts.start).toBe("next start");
  });
});
