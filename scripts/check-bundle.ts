/**
 * `npm run check:bundle [-- <dir>] [--update-baseline]` (decisions 125, 142).
 * Run it after `next build`; it reads `.next/static` (or <dir>) and never
 * builds anything itself. Two gates:
 *
 * 1. Server-only strings (decision 125): fails when the browser bundle
 *    contains one (scripts/bundle-rules.ts).
 * 2. First-load size per route (decision 142): the gzip size of each route's
 *    first-load JavaScript, from `<distDir>/diagnostics/route-bundle-stats.json`
 *    (written by `next build`), against `scripts/bundle-baseline.json` with a
 *    5% tolerance. It keeps the peek's editor out of the list routes
 *    (src/components/detail/peek-detail-lazy.tsx). `--update-baseline`
 *    rewrites the baseline from the current build; commit it with the change
 *    that moved the sizes.
 *
 * route-bundle-stats.json is an internal Next file, not a documented API, so
 * it is read defensively: a missing file or a changed shape fails with a
 * message naming both.
 *
 * Exit codes: 0 clean, 1 findings or a route over budget, 2 the directory,
 * the stats file or the baseline is missing or unreadable (build first).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { FORBIDDEN, scanBundle } from "./bundle-rules";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DIR = ".next/static";
export const BASELINE_PATH = path.join(REPO_ROOT, "scripts", "bundle-baseline.json");
export const STATS_FILE = path.join("diagnostics", "route-bundle-stats.json");
/** A route may grow by this share of its baseline before the gate fails. */
export const TOLERANCE = 0.05;

export type RouteSizes = Record<string, number>;
export type Baseline = { tolerance: number; routes: RouteSizes };
export type RouteRow = { route: string; bytes: number; baseline: number | null; delta: number | null; status: "ok" | "over" | "new" };

/** A problem with the build output or the baseline rather than with a route's size (exit code 2). */
export class BudgetInputError extends Error {}

const SHAPE = `an array of { route: string, firstLoadChunkPaths: string[] } entries`;

/** The stats entries of `<distDir>/diagnostics/route-bundle-stats.json`; throws BudgetInputError naming the file when it is missing or not the expected shape. */
export function readRouteStats(distDir: string): { route: string; chunks: string[] }[] {
  const file = path.join(distDir, STATS_FILE);
  if (!fs.existsSync(file)) {
    throw new BudgetInputError(`${file} does not exist. \`next build\` writes it; run \`npm run build\` first (a dev server does not).`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new BudgetInputError(`${file} is not valid JSON (${(error as Error).message}); expected ${SHAPE}.`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new BudgetInputError(`${file} has an unexpected shape (expected ${SHAPE}); Next may have changed this internal file, so update scripts/check-bundle.ts.`);
  }
  return parsed.map((entry: unknown, index) => {
    const { route, firstLoadChunkPaths } = (entry ?? {}) as { route?: unknown; firstLoadChunkPaths?: unknown };
    if (typeof route !== "string" || !Array.isArray(firstLoadChunkPaths) || !firstLoadChunkPaths.every((chunk) => typeof chunk === "string")) {
      throw new BudgetInputError(`${file} entry ${index} has an unexpected shape (expected ${SHAPE}); Next may have changed this internal file, so update scripts/check-bundle.ts.`);
    }
    return { route, chunks: [...new Set(firstLoadChunkPaths as string[])] };
  });
}

/** First-load gzip bytes (level 6) per route. Chunk paths are relative to `baseDir` (the project root); every chunk is compressed once. */
export function routeSizes(stats: { route: string; chunks: string[] }[], baseDir: string): RouteSizes {
  const cache = new Map<string, number>();
  const gzipSize = (chunk: string) => {
    let size = cache.get(chunk);
    if (size === undefined) {
      const file = path.resolve(baseDir, chunk);
      if (!fs.existsSync(file)) throw new BudgetInputError(`${file} is listed in the route bundle stats but does not exist; rebuild (\`npm run build\`).`);
      size = zlib.gzipSync(fs.readFileSync(file)).length;
      cache.set(chunk, size);
    }
    return size;
  };
  const sizes: RouteSizes = {};
  for (const { route, chunks } of stats) sizes[route] = chunks.reduce((total, chunk) => total + gzipSize(chunk), 0);
  return sizes;
}

export function readBaseline(file: string): Baseline {
  if (!fs.existsSync(file)) {
    throw new BudgetInputError(`${file} does not exist. After a build, run \`npx tsx scripts/check-bundle.ts --update-baseline\` and commit it.`);
  }
  let parsed: { tolerance?: unknown; routes?: unknown };
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new BudgetInputError(`${file} is not valid JSON (${(error as Error).message}); rewrite it with \`npx tsx scripts/check-bundle.ts --update-baseline\`.`);
  }
  const routes = parsed.routes;
  const isRoutes = typeof routes === "object" && routes !== null && Object.values(routes).every((bytes) => typeof bytes === "number");
  if (!isRoutes) throw new BudgetInputError(`${file} has an unexpected shape (expected { tolerance, routes: { [route]: bytes } }); rewrite it with \`npx tsx scripts/check-bundle.ts --update-baseline\`.`);
  return { tolerance: typeof parsed.tolerance === "number" ? parsed.tolerance : TOLERANCE, routes: routes as RouteSizes };
}

/** A route fails when it is over baseline * (1 + tolerance), or when it has no baseline (a new route; record it with --update-baseline). */
export function compareToBaseline(sizes: RouteSizes, baseline: Baseline): RouteRow[] {
  return Object.keys(sizes)
    .sort((a, b) => sizes[b] - sizes[a] || a.localeCompare(b))
    .map((route) => {
      const bytes = sizes[route];
      const expected = baseline.routes[route];
      if (expected === undefined) return { route, bytes, baseline: null, delta: null, status: "new" as const };
      const delta = Math.round((bytes / expected - 1) * 1e6) / 1e6; // 1050 / 1000 - 1 is 0.05000000000000004 in floating point
      return { route, bytes, baseline: expected, delta, status: delta > baseline.tolerance ? ("over" as const) : ("ok" as const) };
    });
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

export function formatTable(rows: RouteRow[]): string {
  const width = Math.max(5, ...rows.map((row) => row.route.length));
  const lines = [`${"route".padEnd(width)}  ${"first-load gz".padStart(13)}  ${"baseline".padStart(11)}  ${"change".padStart(7)}  status`];
  for (const row of rows) {
    const delta = row.delta === null ? "" : `${row.delta >= 0 ? "+" : ""}${(row.delta * 100).toFixed(1)}%`;
    lines.push(`${row.route.padEnd(width)}  ${kb(row.bytes).padStart(13)}  ${(row.baseline === null ? "-" : kb(row.baseline)).padStart(11)}  ${delta.padStart(7)}  ${row.status}`);
  }
  return lines.join("\n");
}

export function baselineJson(sizes: RouteSizes): string {
  const routes = Object.fromEntries(Object.keys(sizes).sort().map((route) => [route, sizes[route]]));
  return `${JSON.stringify({ tolerance: TOLERANCE, unit: "bytes, gzip level 6, first-load JavaScript per route", routes }, null, 2)}\n`;
}

/** Sizes for the build whose static directory is `staticDir`; chunk paths in the stats are relative to the directory above the dist dir. */
function currentSizes(staticDir: string): RouteSizes {
  const distDir = path.dirname(staticDir);
  return routeSizes(readRouteStats(distDir), path.dirname(distDir));
}

function main(args: string[]): number {
  const isUpdate = args.includes("--update-baseline");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const dir = path.resolve(REPO_ROOT, positional[0] ?? DEFAULT_DIR);
  if (!fs.existsSync(dir)) {
    console.error(`${dir} does not exist. Run \`npm run build\` first (a build writes .next; dev uses .next/dev).`);
    return 2;
  }
  let sizes: RouteSizes;
  let baseline: Baseline | null = null;
  try {
    sizes = currentSizes(dir);
    if (isUpdate) {
      fs.writeFileSync(BASELINE_PATH, baselineJson(sizes));
      console.log(`Bundle baseline written: ${Object.keys(sizes).length} routes in ${path.relative(REPO_ROOT, BASELINE_PATH)}.`);
    } else {
      baseline = readBaseline(BASELINE_PATH);
    }
  } catch (error) {
    if (!(error instanceof BudgetInputError)) throw error;
    console.error(`Bundle check cannot run: ${error.message}`);
    return 2;
  }

  const { files, findings } = scanBundle(dir);
  let failed = false;
  if (findings.length === 0) {
    console.log(`Bundle check passed: ${files} files in ${path.relative(REPO_ROOT, dir) || dir} contain none of ${FORBIDDEN.join(", ")}.`);
  } else {
    failed = true;
    console.error(`Bundle check failed: server-only strings in the browser bundle (${path.relative(REPO_ROOT, dir) || dir}):`);
    for (const finding of findings) console.error(`  ${finding.file}: ${finding.needle} x${finding.count}  ...${finding.context}...`);
    console.error("No phrase is exempt: reword client copy so it does not spell a forbidden string (e.g. write \"the Anthropic API key\", not the variable name).");
  }

  if (baseline !== null) {
    const rows = compareToBaseline(sizes, baseline);
    console.log(formatTable(rows));
    const bad = rows.filter((row) => row.status !== "ok");
    if (bad.length === 0) {
      console.log(`First-load budget passed: ${rows.length} routes within ${baseline.tolerance * 100}% of scripts/bundle-baseline.json.`);
    } else {
      failed = true;
      for (const row of bad) {
        console.error(row.status === "new" ? `  ${row.route}: no baseline entry (a new route).` : `  ${row.route}: ${kb(row.bytes)} is ${((row.delta ?? 0) * 100).toFixed(1)}% over its baseline ${kb(row.baseline ?? 0)} (limit ${baseline.tolerance * 100}%).`);
      }
      console.error("First-load budget failed. Find what entered the first load (a static import of the editor?); if the growth is intended, run `npx tsx scripts/check-bundle.ts --update-baseline` and commit scripts/bundle-baseline.json.");
    }
  }
  return failed ? 1 : 0;
}

/** Whether this file is the entry point. Both sides go through `realpathSync`, so a symlinked checkout still runs the gate instead of passing it silently. */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(path.resolve(entry)) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// Importing this file (tests) runs nothing; `tsx scripts/check-bundle.ts` runs the gate.
if (isEntryPoint()) process.exitCode = main(process.argv.slice(2));
