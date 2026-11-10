/** The first-load size gate of scripts/check-bundle.ts (decision 142) on throwaway build directories. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BudgetInputError,
  baselineJson,
  compareToBaseline,
  formatTable,
  readBaseline,
  readRouteStats,
  routeSizes,
  type Baseline,
} from "../scripts/check-bundle";

let root: string;

/** A project root with a `.next` build: `chunks` are written under .next/static/chunks, `stats` becomes route-bundle-stats.json. */
function build(chunks: Record<string, string>, stats: unknown): string {
  const distDir = path.join(root, ".next");
  fs.mkdirSync(path.join(distDir, "static", "chunks"), { recursive: true });
  fs.mkdirSync(path.join(distDir, "diagnostics"), { recursive: true });
  for (const [name, body] of Object.entries(chunks)) fs.writeFileSync(path.join(distDir, "static", "chunks", name), body);
  fs.writeFileSync(path.join(distDir, "diagnostics", "route-bundle-stats.json"), JSON.stringify(stats));
  return distDir;
}

const gz = (text: string) => zlib.gzipSync(text).length;
const noise = (seed: number, length: number) => Array.from({ length }, (_, index) => ((index * 2654435761 + seed * 40503) % 997).toString(36)).join("");
const entry = (route: string, ...names: string[]) => ({ route, firstLoadUncompressedJsBytes: 1, firstLoadChunkPaths: names.map((name) => `.next/static/chunks/${name}`) });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tessera-budget-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("first-load sizes", () => {
  it("sums the gzip size of each route's chunks, counting a chunk shared by two routes once per route and a listed twice chunk once", () => {
    const a = noise(1, 4000);
    const b = noise(2, 2500);
    const distDir = build({ "a.js": a, "b.js": b }, [entry("/one", "a.js", "a.js", "b.js"), entry("/two", "a.js")]);
    const sizes = routeSizes(readRouteStats(distDir), root);
    expect(sizes).toEqual({ "/one": gz(a) + gz(b), "/two": gz(a) });
  });

  it("names the missing chunk when a listed file is gone", () => {
    const distDir = build({}, [entry("/one", "gone.js")]);
    expect(() => routeSizes(readRouteStats(distDir), root)).toThrow(/gone\.js.*does not exist/);
  });
});

describe("route-bundle-stats.json", () => {
  it("fails with a message naming the file and the build command when it is missing", () => {
    fs.mkdirSync(path.join(root, ".next"));
    expect(() => readRouteStats(path.join(root, ".next"))).toThrow(BudgetInputError);
    expect(() => readRouteStats(path.join(root, ".next"))).toThrow(/route-bundle-stats\.json does not exist.*npm run build/);
  });

  it.each([
    ["not JSON", "{oops"],
    ["not an array", JSON.stringify({ routes: [] })],
    ["empty", "[]"],
    ["entries without chunk lists", JSON.stringify([{ route: "/one", chunks: ["a.js"] }])],
    ["a chunk list of non-strings", JSON.stringify([{ route: "/one", firstLoadChunkPaths: [1] }])],
  ])("fails with the expected shape when it is %s", (_label, text) => {
    const distDir = build({}, []);
    fs.writeFileSync(path.join(distDir, "diagnostics", "route-bundle-stats.json"), text);
    expect(() => readRouteStats(distDir)).toThrow(BudgetInputError);
    expect(() => readRouteStats(distDir)).toThrow(/route-bundle-stats\.json[\s\S]*(firstLoadChunkPaths|valid JSON)/);
  });
});

describe("compareToBaseline", () => {
  const baseline: Baseline = { tolerance: 0.05, routes: { "/list": 1000, "/home": 500 } };

  it("passes at and under the baseline, and up to 5% above it", () => {
    const rows = compareToBaseline({ "/list": 1050, "/home": 400 }, baseline);
    expect(rows.map((row) => row.status)).toEqual(["ok", "ok"]);
  });

  it("fails a route more than 5% above its baseline, and only that route", () => {
    const rows = compareToBaseline({ "/list": 1051, "/home": 500 }, baseline);
    expect(Object.fromEntries(rows.map((row) => [row.route, row.status]))).toEqual({ "/list": "over", "/home": "ok" });
    expect(rows[0].delta).toBeCloseTo(0.051, 3);
  });

  it("fails the editor coming back into a list route's first load (a static import)", () => {
    const rows = compareToBaseline({ "/list": 1000 + 276 * 1024, "/home": 500 }, baseline);
    expect(rows.find((row) => row.route === "/list")?.status).toBe("over");
  });

  it("flags a route without a baseline, and ignores a baseline route the build no longer has", () => {
    const rows = compareToBaseline({ "/list": 1000, "/fresh": 10 }, baseline);
    expect(rows.find((row) => row.route === "/fresh")).toMatchObject({ status: "new", baseline: null });
    expect(rows.map((row) => row.route)).not.toContain("/home");
  });

  it("prints a table with one row per route, largest first", () => {
    const table = formatTable(compareToBaseline({ "/list": 1051, "/home": 400 }, baseline));
    const lines = table.split("\n");
    expect(lines[0]).toMatch(/route.*first-load gz.*baseline.*change.*status/);
    expect(lines[1]).toMatch(/^\/list.*\+5\.1%.*over$/);
    expect(lines[2]).toMatch(/^\/home.*-20\.0%.*ok$/);
  });
});

describe("the baseline file", () => {
  it("round-trips through baselineJson, routes sorted", () => {
    const file = path.join(root, "bundle-baseline.json");
    fs.writeFileSync(file, baselineJson({ "/b": 2, "/a": 1 }));
    expect(readBaseline(file)).toEqual({ tolerance: 0.05, routes: { "/a": 1, "/b": 2 } });
    expect(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).routes)).toEqual(["/a", "/b"]);
  });

  it("fails with the update command when it is missing or malformed", () => {
    const file = path.join(root, "bundle-baseline.json");
    expect(() => readBaseline(file)).toThrow(/does not exist.*--update-baseline/);
    fs.writeFileSync(file, JSON.stringify({ routes: { "/a": "big" } }));
    expect(() => readBaseline(file)).toThrow(/unexpected shape.*--update-baseline/);
    fs.writeFileSync(file, "nope");
    expect(() => readBaseline(file)).toThrow(/not valid JSON.*--update-baseline/);
  });

  it("the committed baseline reads, and names the routes whose editor the lazy peek removed", () => {
    const committed = readBaseline(path.join(__dirname, "..", "scripts", "bundle-baseline.json"));
    expect(committed.tolerance).toBe(0.05);
    // The list routes' first load without the editor stack (decision 142): above this, the static import is back.
    // Reset for Astryx 0.7.11, whose motion engine added about 200 KB; the editor still adds about 175 KB on top.
    const ceiling = 920 * 1024;
    for (const route of ["/projects/[projectId]/work-items", "/projects/[projectId]/views/[viewId]", "/projects/[projectId]/modules/[moduleId]", "/projects/[projectId]/archives/work-items"]) {
      expect(committed.routes[route], route).toBeLessThan(ceiling);
    }
    expect(committed.routes["/projects/[projectId]/cycles/[cycleId]"]).toBeLessThan(1040 * 1024);
  });
});
