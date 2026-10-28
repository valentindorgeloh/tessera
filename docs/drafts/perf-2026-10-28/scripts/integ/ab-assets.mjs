// A/B (interleaved A,B,A,B...) per-route load probe on two production servers, after route-assets.mjs.
// Usage: node ab-assets.mjs <portA> <portB> <small|large> <cpu> <n> <routes,comma> <outFile>
// Each sample: fresh context (cold HTTP cache), 375x812 mobile viewport, CPU throttle <cpu>, load + settle 3.5 s.
import fs from "node:fs";
import os from "node:os";
import { chromium } from "playwright";

const [portA, portB, db, cpuArg, nArg, routesArg, outFile] = process.argv.slice(2);
const cpu = Number(cpuArg), n = Number(nArg);
const IDS = {
  small: { project: "01a160df-642f-7102-859a-8c50a72e7f1e", item: "01a160df-6440-736b-a03e-3ac1380b7a52", cycle: "01a160df-6439-75b4-ab0b-dff5f4ebf05b" },
  large: { project: "01a16ad8-6ddd-7752-91fa-653ae8b8a394", item: null, cycle: "01a16ad8-6e17-7633-a09f-7f1dfdf9d55b" },
};
const S = IDS[db];
const P = `/projects/${S.project}`;
const ROUTES = { home: "/", "wi-list": `${P}/work-items`, cycle: `${P}/cycles/${S.cycle}`, "wi-peek": S.item ? `${P}/work-items?peek=${S.item}` : null, analytics: "/analytics/overview" };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const load = () => os.loadavg().map((x) => x.toFixed(1)).join(" ");

const browser = await chromium.launch();
async function sample(port, path) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Performance.enable");
  if (cpu !== 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  const reqs = new Map(); let jsFiles = 0, jsBytes = 0;
  cdp.on("Network.responseReceived", (e) => reqs.set(e.requestId, e.type));
  cdp.on("Network.loadingFinished", (e) => { if (reqs.get(e.requestId) === "Script") { jsFiles++; jsBytes += e.encodedDataLength; } });
  await page.addInitScript(() => {
    window.__m = { fcp: null, lcp: null, lt: 0, row: null };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") window.__m.fcp = e.startTime; }).observe({ type: "paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.lt += e.duration; }).observe({ type: "longtask", buffered: true });
    const iv = setInterval(() => { if (document.querySelector("[data-list-ready], li.tessera-wi-row")) { window.__m.row = performance.now(); clearInterval(iv); } }, 25);
  });
  await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load", timeout: 120_000 });
  await page.waitForTimeout(3500);
  const metrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const m = await page.evaluate(() => window.__m);
  const nodes = await page.evaluate(() => document.getElementsByTagName("*").length);
  await ctx.close();
  return { scriptMs: Math.round(metrics.ScriptDuration * 1000), taskMs: Math.round(metrics.TaskDuration * 1000), layoutMs: Math.round(metrics.LayoutDuration * 1000), styleMs: Math.round(metrics.RecalcStyleDuration * 1000), longTaskMs: Math.round(m.lt), fcp: Math.round(m.fcp ?? -1), lcp: Math.round(m.lcp ?? -1), rowMs: Math.round(m.row ?? -1), jsFiles, jsKB: Math.round(jsBytes / 1024), nodes };
}

const out = { at: new Date().toISOString(), db, cpu, n, load_before: load(), routes: {} };
for (const name of routesArg.split(",")) {
  const path = ROUTES[name];
  if (!path) continue;
  const A = [], B = [];
  await sample(portA, path); await sample(portB, path); // warm both servers (route compile, page cache), discarded
  for (let i = 0; i < n; i++) {
    const order = [["A", portA, A], ["B", portB, B]];
    for (const [, port, arr] of order) arr.push(await sample(port, path));
  }
  const med = (arr) => Object.fromEntries(Object.keys(arr[0]).map((k) => [k, median(arr.map((x) => x[k]))]));
  out.routes[name] = { A: med(A), B: med(B), samplesA: A, samplesB: B };
  console.log(name, `cpu${cpu}`, "A", JSON.stringify(out.routes[name].A));
  console.log(name, `cpu${cpu}`, "B", JSON.stringify(out.routes[name].B));
}
out.load_after = load();
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
await browser.close();
