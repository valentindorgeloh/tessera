// Decision 115 spec loop (one page, list/board/table interleaved, grouped by state), with an optional trace around each run.
// usage: node board.mjs <set> <rounds> <tag> [trace=0|1] [vp=d|m]
import fs from "node:fs";
import { chromium } from "playwright";
import { SETS, RES, layoutPath, load, median, pct } from "./common.mjs";
const [set = "large", roundsArg = "12", tag = "board", traceArg = "0", vp = "d"] = process.argv.slice(2);
const rounds = Number(roundsArg), WARM = 2, doTrace = traceArg === "1";
const { port } = SETS[set];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: vp === "m" ? { width: 375, height: 812 } : { width: 1440, height: 900 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
if (vp === "m") await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await page.addInitScript(() => {
  const w = window; w.__lt = []; w.__paint = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: "longtask", buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__paint.push([e.name, Math.round(e.startTime)]); }).observe({ type: "paint", buffered: true }); } catch {}
  const tick = () => { const el = [...document.querySelectorAll("[data-list-ready]")].find((e) => e.checkVisibility()); if (el) { w.__listReady = performance.now(); w.__readyNodes = document.getElementsByTagName("*").length; w.__hydratedAtReady = Object.keys(el).some((k) => k.startsWith("__reactFiber")); } else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const url = (layout) => `http://127.0.0.1:${port}${layoutPath(set, layout, "state")}`;
const out = { set, vp, rounds, load0: load(), runs: [] };
const TRACE_CATS = ["devtools.timeline", "disabled-by-default-devtools.timeline", "loading", "toplevel", "blink.user_timing"];
for (let round = 0; round < WARM + rounds; round++) {
  for (const layout of ["list", "board", "table"]) {
    const traceThis = doTrace && layout === "board" && round >= WARM;
    const tf = `${RES}/profile-${tag}.r${round}.trace.json`;
    if (traceThis) await b.startTracing(page, { path: tf, categories: TRACE_CATS });
    await page.goto(url(layout), { waitUntil: "commit" });
    const h = await page.waitForFunction(() => window.__listReady, null, { timeout: 180000, polling: 20 });
    const ms = Math.round(await h.jsonValue());
    await page.waitForLoadState("load", { timeout: 300000 });
    await page.evaluate(() => new Promise((resolve) => { let last = performance.now(), quiet = 0; const ping = () => { const n = performance.now(); quiet = n - last < 100 ? quiet + (n - last) : 0; last = n; if (quiet >= 500) resolve(); else setTimeout(ping, 50); }; setTimeout(ping, 50); }));
    if (traceThis) await b.stopTracing();
    const info = await page.evaluate(() => { const nav = performance.getEntriesByType("navigation")[0]; return { lt: window.__lt, paint: window.__paint, hydratedAtReady: window.__hydratedAtReady, nodesAtReady: window.__readyNodes, ttfb: Math.round(nav.responseStart), respEnd: Math.round(nav.responseEnd), domContentLoaded: Math.round(nav.domContentLoadedEventEnd), loadEnd: Math.round(nav.loadEventEnd) }; });
    const rec = { round, layout, ms, warm: round < WARM, load: load(), ...info };
    if (traceThis) {
      const fast = ms < 600; globalThis.keptFast = globalThis.keptFast ?? 0; globalThis.keptSlow = globalThis.keptSlow ?? 0;
      if (fast && globalThis.keptFast < 2) { globalThis.keptFast++; rec.traceFile = tf; }
      else if (!fast && globalThis.keptSlow < 3) { globalThis.keptSlow++; rec.traceFile = tf; }
      else fs.rmSync(tf, { force: true });
    }
    out.runs.push(rec);
    process.stdout.write(`r${round} ${layout} ${ms} hydAtReady=${info.hydratedAtReady} lt=${JSON.stringify(info.lt.slice(0, 4))} load=${rec.load.split(" ")[0]}\n`);
    fs.writeFileSync(`${RES}/profile-${tag}.json`, JSON.stringify(out, null, 1));
  }
}
out.load1 = load();
const sum = {};
for (const layout of ["list", "board", "table"]) { const t = out.runs.filter((r) => r.layout === layout && !r.warm).map((r) => r.ms); sum[layout] = { n: t.length, p50: median(t), p95: pct(t, 95), min: Math.min(...t), max: Math.max(...t), runs: t }; }
out.summary = sum;
fs.writeFileSync(`${RES}/profile-${tag}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(sum));
await b.close();
