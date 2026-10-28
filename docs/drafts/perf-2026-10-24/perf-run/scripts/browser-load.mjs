// b. Browser hard load per route: fresh context per run (cold HTTP cache), routes interleaved per round.
// Usage: node browser-load.mjs <small|large> <desktop|mobile> [rounds=5] [routeFilter]
// desktop = 1440x900 no throttle; mobile = 375x812, touch, CPU throttle 4x (CDP Emulation.setCPUThrottlingRate).
import fs from "node:fs";
import { chromium } from "playwright";
import { SETS, routesFor, median, pct, load } from "./routes.mjs";
import { INIT } from "./perf-init.mjs";

const set = process.argv[2] ?? "small";
const mode = process.argv[3] ?? "desktop";
const rounds = Number(process.argv[4] ?? 5);
const filter = process.argv[5] ? new RegExp(process.argv[5]) : null;
const base = `http://127.0.0.1:${SETS[set].port}`;
const routes = routesFor(set).filter(([name]) => !filter || filter.test(name));
const OUT = new URL(`../results/browser-${set}-${mode}${filter ? "-" + process.argv[5].replace(/\W/g, "") : ""}.json`, import.meta.url).pathname;

const ctxOpts =
  mode === "mobile"
    ? { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

const browser = await chromium.launch();

async function measure(path, readySel) {
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  if (mode === "mobile") await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const reqs = new Map();
  const bytes = { script: 0, css: 0, document: 0, fetch: 0, font: 0, other: 0, total: 0, scriptCount: 0 };
  cdp.on("Network.responseReceived", (e) => reqs.set(e.requestId, { type: e.type, url: e.response.url }));
  cdp.on("Network.loadingFinished", (e) => {
    const r = reqs.get(e.requestId);
    const type = (r?.type ?? "Other").toLowerCase();
    const key = type === "stylesheet" ? "css" : type in bytes ? type : type === "xhr" ? "fetch" : "other";
    bytes[key] += e.encodedDataLength;
    bytes.total += e.encodedDataLength;
    if (key === "script") bytes.scriptCount += 1;
  });
  await page.addInitScript(INIT, readySel);
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(base + path, { waitUntil: "commit", timeout: 60_000 });
  await page.waitForFunction(() => window.__perf && window.__perf.ready !== null, null, { timeout: 60_000, polling: 50 });
  await page.waitForLoadState("load", { timeout: 60_000 });
  // Let hydration and post-load effects finish so their long tasks are counted.
  await page.waitForFunction(() => window.__perf.hydrated !== null, null, { timeout: mode === "mobile" ? 120_000 : 60_000, polling: 100 }).catch(() => {});
  await page.waitForTimeout(mode === "mobile" ? 2000 : 1000);
  const r = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    const P = window.__perf;
    const ltTotal = P.lt.reduce((s, [, d]) => s + d, 0);
    const ltToReady = P.lt.filter(([s]) => s < P.ready).reduce((s, [, d]) => s + d, 0);
    return {
      ttfb: n.responseStart,
      responseEnd: n.responseEnd,
      dcl: n.domContentLoadedEventEnd,
      load: n.loadEventEnd,
      fcp: P.fcp,
      lcp: P.lcp,
      ready: P.ready,
      hydrated: P.hydrated,
      longTasks: P.lt.length,
      longTaskTotal: ltTotal,
      longTaskToReady: ltToReady,
      longestTask: P.lt.reduce((m, [, d]) => Math.max(m, d), 0),
      nodes: P.nodes,
      htmlBytes: n.encodedBodySize,
      htmlDecoded: n.decodedBodySize,
    };
  });
  await context.close();
  return { ...r, bytes, errors };
}

const result = { set, mode, rounds, startedAt: new Date().toISOString(), loadBefore: load(), runs: {} };
for (const [name] of routes) result.runs[name] = [];
// Warm the server once per route (the server's first hit is measured in server-timing.mjs).
for (const [, path] of routes) await fetch(base + path).then((r) => r.text());
for (let i = 0; i < rounds; i++) {
  for (const [name, path, sel] of routes) {
    try {
      result.runs[name].push(await measure(path, sel));
    } catch (err) {
      result.runs[name].push({ error: String(err).slice(0, 200) });
    }
  }
  process.stdout.write(`round ${i + 1} done, load ${load()}\n`);
}
result.loadAfter = load();
result.summary = {};
for (const [name, path] of routes) {
  const runs = result.runs[name].filter((x) => !x.error);
  const m = (k) => {
    const v = median(runs.map((x) => x[k]));
    return v === null ? null : Math.round(v);
  };
  result.summary[name] = {
    ttfb: m("ttfb"),
    fcp: m("fcp"),
    lcp: m("lcp"),
    ready: m("ready"),
    ready_p95: Math.round(pct(runs.map((x) => x.ready), 95) ?? NaN),
    hydrated: m("hydrated"),
    load: m("load"),
    lt_total: m("longTaskTotal"),
    lt_max: m("longestTask"),
    js_kb: Math.round(median(runs.map((x) => x.bytes.script)) / 1024),
    js_files: median(runs.map((x) => x.bytes.scriptCount)),
    css_kb: Math.round(median(runs.map((x) => x.bytes.css)) / 1024),
    html_kb: Math.round(median(runs.map((x) => x.htmlBytes)) / 1024),
    html_raw_kb: Math.round(median(runs.map((x) => x.htmlDecoded)) / 1024),
    nodes: m("nodes"),
    n: runs.length,
    errs: result.runs[name].length - runs.length,
  };
}
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`load before ${result.loadBefore} after ${result.loadAfter}`);
console.table(result.summary);
await browser.close();
