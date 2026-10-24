// Per-route asset + coverage probe against the prod build on :3843 (indicative, shared machine).
// Usage: node route-assets.mjs <mobile|desktop> [rounds=1] [routeNameFilter]
// For each route (fresh context, cold HTTP cache): requests by type (count, encoded bytes), JS coverage (bytes executed
// at load + settle), CSS coverage (bytes applied), CDP Performance metrics (Script/Layout/RecalcStyle/Task durations).
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
const require = createRequire("/Users/valentindorgeloh/Documents/Github/tessera/package.json");
const { chromium } = require("playwright");

const mode = process.argv[2] ?? "mobile";
const rounds = Number(process.argv[3] ?? 1);
const filter = process.argv[4] ? new RegExp(process.argv[4]) : null;
const port = process.env.PORT ?? "3843";
const base = `http://127.0.0.1:${port}`;
const S = { project: "01a160df-642f-7102-859a-8c50a72e7f1e", item: "01a160df-6440-736b-a03e-3ac1380b7a52", cycle: "01a160df-6439-75b4-ab0b-dff5f4ebf05b", page: "01a160e1-a737-762a-bb97-10c20cc4257f" };
const P = `/projects/${S.project}`;
const ROUTES = [
  ["settings", "/settings/general"],
  ["home", "/"],
  ["wi-list", `${P}/work-items`],
  ["wi-peek", `${P}/work-items?peek=${S.item}`],
  ["inbox", "/inbox"],
  ["page", `${P}/pages/${S.page}`],
  ["cycle", `${P}/cycles/${S.cycle}`],
  ["analytics", "/analytics/overview"],
].filter(([n]) => !filter || filter.test(n));

const ctxOpts = mode === "mobile" ? { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } };
const browser = await chromium.launch();
const out = {};

for (const [name, path] of ROUTES) {
  out[name] = [];
  for (let r = 0; r < rounds; r++) {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Performance.enable");
    if (mode === "mobile") await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const reqs = new Map();
    const t = { script: [0, 0], css: [0, 0], font: [0, 0], document: [0, 0], fetch: [0, 0], other: [0, 0] };
    cdp.on("Network.responseReceived", (e) => reqs.set(e.requestId, { type: e.type, url: e.response.url }));
    cdp.on("Network.loadingFinished", (e) => {
      const q = reqs.get(e.requestId); if (!q) return;
      const ty = q.type.toLowerCase(); const k = ty === "stylesheet" ? "css" : ty === "xhr" ? "fetch" : ty in t ? ty : "other";
      t[k][0] += 1; t[k][1] += e.encodedDataLength;
    });
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await page.coverage.startCSSCoverage({ resetOnNavigation: false });
    await page.addInitScript(() => {
      window.__m = { fcp: null, lcp: null, lt: 0 };
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") window.__m.fcp = e.startTime; }).observe({ type: "paint", buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.lt += e.duration; }).observe({ type: "longtask", buffered: true });
    });
    await page.goto(base + path, { waitUntil: "load", timeout: 90_000 });
    await page.waitForTimeout(mode === "mobile" ? 3500 : 1500); // settle: hydration, poller, effects
    const metrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    const m = await page.evaluate(() => window.__m);
    const js = await page.coverage.stopJSCoverage();
    const css = await page.coverage.stopCSSCoverage();
    const jsApp = js.filter((e) => e.url.includes("/_next/static/"));
    const jsTotal = jsApp.reduce((s, e) => s + (e.source?.length ?? 0), 0);
    let used = 0;
    for (const e of jsApp) {
      // V8 block coverage: ranges nest, the innermost range wins; paint outer-to-inner by sorting on start asc, end desc.
      const src = e.source ?? ""; const mark = new Uint8Array(src.length);
      const rs = (e.functions ?? []).flatMap((f) => f.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
      for (const x of rs) { const v = x.count > 0 ? 1 : 0; mark.fill(v, x.startOffset, x.endOffset); }
      used += mark.reduce((s, v) => s + v, 0);
    }
    const cssApp = css.filter((e) => e.url.includes("/_next/static/"));
    const cssTotal = cssApp.reduce((s, e) => s + e.text.length, 0);
    const cssUsed = cssApp.reduce((s, e) => s + e.ranges.reduce((a, x) => a + (x.end - x.start), 0), 0);
    out[name].push({
      path, mode, fcp: Math.round(m.fcp ?? -1), lcp: Math.round(m.lcp ?? -1), longTaskMs: Math.round(m.lt),
      scriptMs: Math.round(metrics.ScriptDuration * 1000), taskMs: Math.round(metrics.TaskDuration * 1000), layoutMs: Math.round(metrics.LayoutDuration * 1000), styleMs: Math.round(metrics.RecalcStyleDuration * 1000),
      jsFiles: t.script[0], jsKB: Math.round(t.script[1] / 1024), cssFiles: t.css[0], cssKB: +(t.css[1] / 1024).toFixed(1), fontKB: Math.round(t.font[1] / 1024), fetchKB: Math.round(t.fetch[1] / 1024), docKB: Math.round(t.document[1] / 1024),
      jsRawKB: Math.round(jsTotal / 1024), jsUsedKB: Math.round(used / 1024), jsUsedPct: +(used / jsTotal * 100).toFixed(1),
      cssRawKB: Math.round(cssTotal / 1024), cssUsedKB: Math.round(cssUsed / 1024), cssUsedPct: +(cssUsed / cssTotal * 100).toFixed(1),
      nodes: await page.evaluate(() => document.getElementsByTagName("*").length),
    });
    await ctx.close();
  }
  const rows = out[name]; const last = rows[rows.length - 1];
  console.log(name.padEnd(10), JSON.stringify(last));
}
await browser.close();
fs.writeFileSync(new URL(`../results-route-assets-${mode}.json`, import.meta.url).pathname, JSON.stringify({ at: new Date().toISOString(), load: os.loadavg().map((x) => x.toFixed(1)).join(" "), out }, null, 1));
