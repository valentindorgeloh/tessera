// Hard-load timing per route on the small fixture. Fresh browser context per run (cold HTTP cache), server already warm.
// Usage: node browser-probe.mjs <port> <label> [runs=5] [routeFilterRegex]
import fs from "node:fs";
import { chromium } from "/private/tmp/claude-501/-Users-valentindorgeloh-Documents-Github-tessera/8acb4a38-4ac2-4215-9929-95e79d18c45f/scratchpad/perf-research/runtime/tree/node_modules/playwright/index.mjs";
import { INIT } from "./perf-init.mjs";
const [port, label, runsArg, filter] = [process.argv[2], process.argv[3], Number(process.argv[4] ?? 5), process.argv[5]];
const P = "/projects/01a160df-642f-7102-859a-8c50a72e7f1e";
const q = (display) => Buffer.from(JSON.stringify({ display })).toString("base64url");
const ROUTES = [
  ["home", "/", null],
  ["wi-list", `${P}/work-items`, "[data-list-ready]"],
  ["wi-table", `${P}/work-items?q=${q({ layout: "table" })}`, "[data-list-ready]"],
  ["work-item", "/work-items/01a160df-6440-736b-a03e-3ac1380b7a52", '[role="main"] h1'],
  ["cycles", `${P}/cycles`, null],
].filter(([n]) => !filter || new RegExp(filter).test(n));
const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const browser = await chromium.launch();
const res = {};
for (let i = 0; i < runsArg; i++) {
  for (const [name, path, sel] of ROUTES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page); await cdp.send("Network.enable");
    const reqs = new Map(); let js = 0, jsN = 0;
    cdp.on("Network.responseReceived", (e) => reqs.set(e.requestId, e.type));
    cdp.on("Network.loadingFinished", (e) => { if (reqs.get(e.requestId) === "Script") { js += e.encodedDataLength; jsN++; } });
    await page.addInitScript(INIT, sel);
    await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "commit", timeout: 90000 });
    await page.waitForFunction(() => window.__perf && window.__perf.ready !== null, null, { timeout: 90000, polling: 50 });
    await page.waitForLoadState("load", { timeout: 90000 });
    await page.waitForFunction(() => window.__perf.hydrated !== null, null, { timeout: 90000, polling: 100 }).catch(() => {});
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; const P = window.__perf; return { ttfb: n.responseStart, fcp: P.fcp, ready: P.ready, hydrated: P.hydrated, load: n.loadEventEnd, ltTotal: P.lt.reduce((s, [, d]) => s + d, 0), ltMax: Math.max(0, ...P.lt.map(([, d]) => d)) }; });
    (res[name] ??= []).push({ ...r, jsKB: Math.round(js / 1024), jsFiles: jsN });
    await ctx.close();
  }
}
const summary = {};
for (const [name, runs] of Object.entries(res)) {
  summary[name] = Object.fromEntries(["ttfb", "fcp", "ready", "hydrated", "load", "ltTotal", "ltMax", "jsKB", "jsFiles"].map((k) => [k, Math.round(med(runs.map((r) => r[k])) ?? -1)]));
}
const load = (await import("node:child_process")).execSync("uptime").toString().trim().replace(/.*load averages?: /, "");
fs.writeFileSync(new URL(`./results/browser-${label}.json`, import.meta.url), JSON.stringify({ label, port, runs: runsArg, load, summary, res }, null, 1));
console.log(label, "load", load); console.table(summary);
await browser.close();
